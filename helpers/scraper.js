const puppeteer = require('puppeteer-core');
const config = require('../config');
const { performLogin } = require('../login.js'); 
const state = require('./state'); 
const db = require('./database');
const tg = require('./telegram');
const fs = require('fs');

// ================== HELPERS ==================

function normalizeNumber(number) {
    let norm = String(number).trim().replace(/[\s-]/g, "");
    if (!norm.startsWith('+') && /^\d+$/.test(norm)) {
        norm = '+' + norm;
    }
    return norm;
}

function getProgressMessage(currentStep, totalSteps, prefixRange, numCount) {
    const maxLen = config.BAR?.MAX_LENGTH || 12;
    const progressRatio = Math.min(currentStep / 12, 1.0);
    const filledCount = Math.ceil(progressRatio * maxLen);
    const emptyCount = maxLen - filledCount;
    const bar = (config.BAR?.FILLED || "█").repeat(filledCount) + (config.BAR?.EMPTY || "░").repeat(emptyCount);

    let status = config.STATUS_MAP ? config.STATUS_MAP[currentStep] : "Processing...";
    if (!status) {
        if (currentStep < 3) status = "Memulai Sesi...";
        else if (currentStep < 8) status = "Mengambil Nomor...";
        else status = "Menyelesaikan...";
    }

    return `<code>${status}</code>\n<blockquote>Range: <code>${prefixRange}</code> | Jumlah: <code>${numCount}</code></blockquote>\n<code>Load:</code> [${bar}]`;
}

// ================== BROWSER CONTROL ==================

async function initBrowser() {
    try {
        if (state.browser) {
            console.log("[BROWSER] Menutup sesi lama...");
            try { await state.browser.close(); } catch(e){}
        }
        
        console.log("[BROWSER] Membuka Chromium Termux...");
        state.browser = await puppeteer.launch({
            executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--single-process',
                '--disable-extensions'
            ]
        });

        const pages = await state.browser.pages();
        state.sharedPage = pages.length > 0 ? pages[0] : await state.browser.newPage();

        // Optimasi: Blokir gambar agar cepat
        await state.sharedPage.setRequestInterception(true);
        state.sharedPage.on('request', (req) => {
            if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        console.log("[BROWSER] Mencoba Login...");
        const loginSuccess = await performLogin(state.sharedPage, config.STEX_EMAIL, config.STEX_PASSWORD, config.LOGIN_URL);
        
        if (!loginSuccess) throw new Error("Gagal Login ke Website.");

        await state.sharedPage.goto(config.TARGET_URL, { waitUntil: 'networkidle2' });
        console.log("[BROWSER] Siap di Target URL.");
        return true;
    } catch (e) {
        console.error(`[BROWSER ERROR] ${e.message}`);
        return false;
    }
}

async function getNumberAndCountryFromRow(rowSelector, page) {
    try {
        const data = await page.evaluate(sel => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const phoneEl = el.querySelector("td:nth-child(1) span.font-mono");
            const statusEl = el.querySelector("td:nth-child(1) div:nth-child(2) span");
            const countryEl = el.querySelector("td:nth-child(2) span.text-slate-200");
            
            return {
                numberRaw: phoneEl ? phoneEl.innerText : null,
                statusText: statusEl ? statusEl.innerText.toLowerCase() : "unknown",
                countryRaw: countryEl ? countryEl.innerText.trim().toUpperCase() : "UNKNOWN"
            };
        }, rowSelector);

        if (!data || !data.numberRaw) return null;
        
        const number = normalizeNumber(data.numberRaw);
        if (db.isInCache(number)) return null;
        
        // Skip nomor yang sudah expired/used
        if (["success", "failed", "expired", "used"].some(s => data.statusText.includes(s))) return null;

        return { number, country: data.countryRaw };
    } catch (e) {
        return null;
    }
}

async function getAllNumbersParallel(page, numToFetch) {
    const tasks = [];
    for (let i = 1; i <= numToFetch + 5; i++) {
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

// ================== MAIN LOGIC ==================

async function processUserInput(userId, prefix, clickCount, usernameTg, firstNameTg, messageIdToEdit = null) {
    let msgId = messageIdToEdit || (state.pendingMessage ? state.pendingMessage[userId] : null);
    let actionInterval = null;
    const numToFetch = parseInt(clickCount) || 1;

    // 1. Validasi awal
    if (!prefix) return tg.tgSend(userId, "❌ Error: Prefix kosong.");

    // 2. Antrian Lock
    const isLocked = state.browserLock.isLocked();
    if (isLocked) {
        const waitMsg = `⏳ <b>Antrean Aktif</b>\nMohon tunggu, bot sedang melayani user lain...\n\n` + getProgressMessage(0, 0, prefix, numToFetch);
        if (!msgId) msgId = await tg.tgSend(userId, waitMsg);
        else await tg.tgEdit(userId, msgId, waitMsg);
    }

    const release = await state.browserLock.acquire();
    console.log(`[JOB] User ${userId} mulai | Range: ${prefix}`);

    try {
        actionInterval = setInterval(() => tg.tgSendAction(userId, "typing").catch(() => {}), 4500);
        let currentStep = 0;

        if (!msgId) msgId = await tg.tgSend(userId, getProgressMessage(currentStep, 0, prefix, numToFetch));

        // 3. Pastikan Browser Siap
        if (!state.browser || !state.sharedPage || state.sharedPage.isClosed()) {
             await initBrowser();
        }

        const page = state.sharedPage;
        
        // Pastikan di URL yang benar
        if (!page.url().includes('get')) { 
            await page.goto(config.TARGET_URL, { waitUntil: 'networkidle2' });
        }

        const INPUT_SELECTOR = "input[name='numberrange']";
        
        // Tunggu input muncul
        await page.waitForSelector(INPUT_SELECTOR, { visible: true, timeout: 15000 });
        
        // Isi Range
        await page.click(INPUT_SELECTOR, { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.type(INPUT_SELECTOR, prefix);
        
        currentStep = 3;
        await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));

        // 4. Cari & Klik Tombol Get Number
        const getNumBtn = await page.evaluateHandle(() => {
            return Array.from(document.querySelectorAll('button')).find(el => el.innerText.includes('Get Number'));
        });

        if (!getNumBtn || !getNumBtn.asElement()) {
            throw new Error("Tombol 'Get Number' tidak ditemukan di halaman.");
        }

        for (let i = 0; i < numToFetch; i++) {
            await getNumBtn.asElement().click();
            await new Promise(r => setTimeout(r, 400));
        }

        // 5. Scan Hasil
        let foundNumbers = [];
        const maxWait = 25; // detik
        const startTime = Date.now() / 1000;

        while ((Date.now() / 1000 - startTime) < maxWait) {
            foundNumbers = await getAllNumbersParallel(page, numToFetch);
            
            if (foundNumbers.length >= numToFetch) break;

            // Animasi progress naik pelan
            if (currentStep < 11) {
                currentStep++;
                await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));
            }
            await new Promise(r => setTimeout(r, 1500));
        }

        if (foundNumbers.length === 0) {
            await tg.tgEdit(userId, msgId, `❌ <b>Gagal!</b>\nTidak ada nomor ditemukan untuk range <code>${prefix}</code>. Coba ganti range.`);
            return;
        }

        // 6. Selesai & Kirim
        currentStep = 12;
        await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));

        const mainCountry = foundNumbers[0].country || "UNKNOWN";
        const emoji = config.COUNTRY_EMOJI?.[mainCountry] || "📞";
        
        let msg = `✅ <b>Numbers Ready!</b>\n\n`;
        foundNumbers.slice(0, numToFetch).forEach((entry, idx) => {
            msg += `${idx+1}. <code>${entry.number}</code>\n`;
            db.saveCache({ number: entry.number, country: entry.country, user_id: userId, time: Date.now() });
            db.addToWaitList(entry.number, userId, usernameTg, firstNameTg);
        });
        msg += `\n${emoji} <b>Country:</b> ${mainCountry}\n🎯 <b>Range:</b> <code>${prefix}</code>`;

        const inlineKb = {
            inline_keyboard: [
                [{ text: "🔄 Ganti 1 Nomor", callback_data: `change_num:1:${prefix}` }],
                [{ text: "🌐 Menu Utama", callback_data: "getnum" }]
            ]
        };

        await tg.tgEdit(userId, msgId, msg, inlineKb);
        console.log(`[SUCCESS] User ${userId} berhasil dapat nomor.`);

    } catch (e) {
        console.error(`[ERROR] ${e.message}`);
        // Kirim screenshot ke admin jika error
        if (state.sharedPage) {
            const errPath = `error_${userId}.png`;
            await state.sharedPage.screenshot({ path: errPath });
        }
        if (msgId) await tg.tgEdit(userId, msgId, `❌ <b>Terjadi Kesalahan:</b>\n<code>${e.message}</code>`);
    } finally {
        if (actionInterval) clearInterval(actionInterval);
        release(); // Penting: Lepas antrean agar user lain bisa masuk
    }
}

module.exports = { initBrowser, processUserInput, getProgressMessage };
