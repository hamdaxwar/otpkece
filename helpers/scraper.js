const puppeteer = require('puppeteer-core');
const config = require('../config');
const { performLogin } = require('../login'); // Pastikan path ini benar
const { state, playwrightLock } = require('./state');
const db = require('./database');
const tg = require('./telegram');

// --- Helper Functions Internal ---

function normalizeNumber(number) {
    let norm = String(number).trim().replace(/[\s-]/g, "");
    if (!norm.startsWith('+') && /^\d+$/.test(norm)) {
        norm = '+' + norm;
    }
    return norm;
}

function getProgressMessage(currentStep, totalSteps, prefixRange, numCount) {
    const progressRatio = Math.min(currentStep / 12, 1.0);
    const filledCount = Math.ceil(progressRatio * (config.BAR?.MAX_LENGTH || 10));
    const emptyCount = (config.BAR?.MAX_LENGTH || 10) - filledCount;
    const bar = (config.BAR?.FILLED || "■").repeat(filledCount) + (config.BAR?.EMPTY || "□").repeat(emptyCount);

    let status = config.STATUS_MAP ? config.STATUS_MAP[currentStep] : "Processing...";
    
    return `<code>${status}</code>\n<blockquote>Range: <code>${prefixRange}</code> | Jumlah: <code>${numCount}</code></blockquote>\n<code>Load:</code> [${bar}]`;
}

// --- Browser Control ---

async function initBrowser() {
    try {
        if (state.browser) {
            try { await state.browser.close(); } catch(e){}
        }
        
        console.log("[BROWSER] Launching Chromium (Puppeteer) in Termux...");
        state.browser = await puppeteer.launch({
            executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
            headless: true, // Ubah ke false jika ingin melihat prosesnya di VNC/GUI
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--single-process'
            ]
        });

        state.sharedPage = await state.browser.newPage();
        
        // Set User Agent Manual agar tidak terdeteksi bot standar
        await state.sharedPage.setUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

        console.log("[BROWSER] Menjalankan proses login...");
        // Memanggil fungsi dari login.js
        const loginSuccess = await performLogin(
            state.sharedPage, 
            process.env.STEX_EMAIL, 
            process.env.STEX_PASSWORD, 
            "https://stexsms.com/login"
        );

        if (loginSuccess) {
            console.log("[BROWSER] Sesi Browser Siap.");
        } else {
            console.error("[BROWSER ERROR] Login tidak berhasil.");
        }
    } catch (e) {
        console.error(`[BROWSER FATAL] ${e.message}`);
    }
}

async function getNumberAndCountryFromRow(rowSelector, page) {
    try {
        const data = await page.evaluate((sel) => {
            const row = document.querySelector(sel);
            if (!row) return null;

            const phoneEl = row.querySelector("td:nth-child(1) span.font-mono");
            const statusEl = row.querySelector("td:nth-child(1) div:nth-child(2) span");
            const countryEl = row.querySelector("td:nth-child(2) span.text-slate-200");

            return {
                numberRaw: phoneEl ? phoneEl.innerText.trim() : null,
                statusText: statusEl ? statusEl.innerText.trim().toLowerCase() : "unknown",
                country: countryEl ? countryEl.innerText.trim().toUpperCase() : "UNKNOWN"
            };
        }, rowSelector);

        if (!data || !data.numberRaw) return null;
        
        // Skip nomor yang sudah selesai atau gagal
        if (data.statusText.includes("success") || data.statusText.includes("failed") || data.statusText.includes("expired")) {
            return null;
        }

        const number = data.numberRaw.replace(/[\s-]/g, "");
        if (db.isInCache && db.isInCache(number)) return null;

        if (number.length > 5) return { number: normalizeNumber(number), country: data.country, status: data.statusText };
        return null;

    } catch (e) {
        return null;
    }
}

async function getAllNumbersParallel(page, numToFetch) {
    const tasks = [];
    // Scan 15 baris pertama untuk mencari nomor aktif
    for (let i = 1; i <= 15; i++) {
        tasks.push(getNumberAndCountryFromRow(`tbody tr:nth-child(${i})`, page));
    }
    const results = await Promise.all(tasks);
    
    const currentNumbers = [];
    const seen = new Set();
    
    for (const res of results) {
        if (res && res.number && !seen.has(res.number)) {
            currentNumbers.push(res);
            seen.add(res.number);
        }
    }
    return currentNumbers;
}

// --- Main Action Logic ---

async function actionTask(userId) {
    return setInterval(() => {
        tg.tgSendAction(userId, "typing").catch(() => {});
    }, 4500);
}

async function processUserInput(userId, prefix, clickCount, usernameTg, firstNameTg, messageIdToEdit = null) {
    let msgId = messageIdToEdit || (state.pendingMessage ? state.pendingMessage[userId] : null);
    let actionInterval = null;
    const numToFetch = parseInt(clickCount);

    // Lock agar tidak ada 2 user menjalankan browser bersamaan (menghindari crash Termux)
    const release = await playwrightLock.acquire();
    
    try {
        actionInterval = await actionTask(userId);
        let currentStep = 0;

        if (!msgId) {
            msgId = await tg.tgSend(userId, getProgressMessage(currentStep, 0, prefix, numToFetch));
        }

        // Cek apakah page masih hidup
        if (!state.sharedPage || state.sharedPage.isClosed()) {
             await initBrowser();
        }

        const page = state.sharedPage;
        const INPUT_SELECTOR = "input[name='numberrange']";
        
        // Input Range
        await page.waitForSelector(INPUT_SELECTOR, { timeout: 15000 });
        await page.click(INPUT_SELECTOR, { clickCount: 3 }); 
        await page.keyboard.press('Backspace');
        await page.type(INPUT_SELECTOR, prefix);
        
        currentStep = 2;
        await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));

        // Klik Tombol Get Number
        const BUTTON_SELECTOR = "//button[contains(text(), 'Get Number')]";
        await page.waitForSelector('xpath/' + BUTTON_SELECTOR, { timeout: 10000 });

        for (let i = 0; i < numToFetch; i++) {
            await page.evaluate((sel) => {
                const btn = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                if (btn) btn.click();
            }, BUTTON_SELECTOR);
            await new Promise(r => setTimeout(r, 400)); 
        }

        currentStep = 5;
        await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));

        // --- Scanning ---
        let foundNumbers = [];
        // Coba scan selama maksimal 15 detik
        const maxWait = 15;
        const startTime = Date.now() / 1000;

        while ((Date.now() / 1000 - startTime) < maxWait) {
            foundNumbers = await getAllNumbersParallel(page, numToFetch);
            if (foundNumbers.length >= numToFetch) break;
            await new Promise(r => setTimeout(r, 1000));
        }

        if (foundNumbers.length === 0) {
            await tg.tgEdit(userId, msgId, "❌ <b>Gagal Mendapatkan Nomor.</b>\nRange mungkin kosong atau lemot. Silakan coba lagi.");
            return;
        }

        // --- Output Berhasil ---
        currentStep = 12;
        await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));

        const mainCountry = foundNumbers[0].country || "UNKNOWN";
        const emoji = config.COUNTRY_EMOJI ? (config.COUNTRY_EMOJI[mainCountry] || "🏳️") : "📞";

        let msg = `✅ <b>Numbers Ready!</b>\n\n`;
        foundNumbers.slice(0, numToFetch).forEach((entry) => {
            msg += `📱 <code>${entry.number}</code>\n`;
            // Simpan ke database
            db.saveCache({ number: entry.number, country: entry.country, user_id: userId, time: Date.now() });
            db.addToWaitList(entry.number, userId, usernameTg, firstNameTg);
        });
        msg += `\n${emoji} ${mainCountry} | Range: <code>${prefix}</code>`;

        const inlineKb = {
            inline_keyboard: [
                [{ text: "🔄 Ganti Nomor", callback_data: `change_num:1:${prefix}` }],
                [{ text: "🌐 Menu Utama", callback_data: "getnum" }]
            ]
        };

        await tg.tgEdit(userId, msgId, msg, inlineKb);

    } catch (e) {
        console.error("[SCRAPER ERROR]", e);
        await tg.tgEdit(userId, msgId, `❌ <b>Error:</b> ${e.message}`);
    } finally {
        if (actionInterval) clearInterval(actionInterval);
        release(); // Lepas kunci lock agar user lain bisa pakai browser
    }
}

module.exports = { initBrowser, processUserInput, getProgressMessage };
