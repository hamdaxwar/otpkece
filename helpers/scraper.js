const puppeteer = require('puppeteer-core');
const config = require('../config');
const { performLogin } = require('../login'); 
const { state } = require('./state');
const db = require('./database');
const tg = require('./telegram');

// ================== HELPERS ==================
function normalizeNumber(number) {
    let norm = String(number).trim().replace(/[\s-]/g, "");
    if (!norm.startsWith('+') && /^\d+$/.test(norm)) {
        norm = '+' + norm;
    }
    return norm;
}

function getProgressMessage(currentStep, totalSteps, prefixRange, numCount) {
    const progressRatio = Math.min(currentStep / 12, 1.0);
    const filledCount = Math.ceil(progressRatio * (config.BAR?.MAX_LENGTH || 12));
    const emptyCount = (config.BAR?.MAX_LENGTH || 12) - filledCount;
    const bar = (config.BAR?.FILLED || "█").repeat(filledCount) + (config.BAR?.EMPTY || "░").repeat(emptyCount);
    const status = config.STATUS_MAP?.[currentStep] || "Processing...";
    return `<code>${status}</code>\n<blockquote>Range: <code>${prefixRange}</code> | Jumlah: <code>${numCount}</code></blockquote>\n<code>Load:</code> [${bar}]`;
}

// ================== BROWSER ==================
async function initBrowser() {
    try {
        if (state.browser) {
            try { await state.browser.close(); } catch(e){}
        }

        console.log("[BROWSER] Launching Chromium...");
        state.browser = await puppeteer.launch({
            executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
            headless: true,
            protocolTimeout: 180000,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--single-process'
            ]
        });

        // ================= LOGIN =================
        const loginPage = await state.browser.newPage();
        await loginPage.setRequestInterception(true);
        loginPage.on('request', req => {
            if (['image','media','font'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        await loginPage.setUserAgent('Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36');

        console.log("[BROWSER] Menjalankan login...");
        const loginSuccess = await performLogin(loginPage, config.STEX_EMAIL, config.STEX_PASSWORD, config.LOGIN_URL);

        const loginShot = 'login_status.png';
        await loginPage.screenshot({ path: loginShot });
        if (process.env.ADMIN_ID) {
            await tg.tgSendPhoto(process.env.ADMIN_ID, loginShot, loginSuccess ? "✅ Login sukses" : "❌ Login gagal").catch(()=>{});
        }

        if (!loginSuccess) {
            console.error("[BROWSER ERROR] Login gagal.");
            return false;
        }
        console.log("[BROWSER] Login sukses.");

        // ================= SHARED PAGE (tab 1) =================
        if (!state.sharedPage || state.sharedPage.isClosed()) {
            state.sharedPage = await state.browser.newPage();
            await state.sharedPage.setRequestInterception(true);
            state.sharedPage.on('request', req => {
                if (['image','media','font'].includes(req.resourceType())) req.abort();
                else req.continue();
            });
            await state.sharedPage.setUserAgent('Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36');

            // Langsung ke TARGET_URL (tab1)
            await state.sharedPage.goto(config.TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
            console.log("[BROWSER] Tab pertama siap di TARGET_URL");
        }

        return true;
    } catch (e) {
        console.error("[BROWSER FATAL]", e.message);
        return false;
    }
}

// ================== SCRAPING ==================
async function getNumberAndCountryFromRow(rowSelector, page) {
    try {
        const data = await page.evaluate(sel => {
            const row = document.querySelector(sel);
            if (!row) return null;
            const phoneEl = row.querySelector("td:nth-child(1) span.font-mono");
            const statusEl = row.querySelector("td:nth-child(1) div:nth-child(2) span");
            const countryEl = row.querySelector("td:nth-child(2) span.text-slate-200");
            return {
                numberRaw: phoneEl?.innerText.trim() || null,
                statusText: statusEl?.innerText.trim().toLowerCase() || "unknown",
                country: countryEl?.innerText.trim().toUpperCase() || "UNKNOWN"
            };
        }, rowSelector);

        if (!data?.numberRaw) return null;
        if (["success","failed","expired","used"].some(s => data.statusText.includes(s))) return null;
        const number = normalizeNumber(data.numberRaw.replace(/[\s-]/g, ""));
        if (db.isInCache(number)) return null;
        return number.length > 5 ? { number, country: data.country } : null;
    } catch {
        return null;
    }
}

async function getAllNumbersParallel(page, numToFetch) {
    const tasks = [];
    for (let i = 1; i <= numToFetch + 5; i++) tasks.push(getNumberAndCountryFromRow(`tbody tr:nth-child(${i})`, page));
    const results = await Promise.all(tasks);

    const currentNumbers = [];
    const seen = new Set();
    for (const res of results) {
        if (res?.number && !seen.has(res.number)) {
            currentNumbers.push(res);
            seen.add(res.number);
        }
    }
    return currentNumbers;
}

// ================== USER INPUT PROCESS ==================
async function processUserInput(userId, prefix, clickCount, usernameTg, firstNameTg, messageIdToEdit = null) {
    let msgId = messageIdToEdit; 
    let actionInterval = null;
    const numToFetch = parseInt(clickCount);

    console.log(`[DEBUG] processUserInput dipanggil | user: ${userId}, prefix: ${prefix}, count: ${numToFetch}`);

    try {
        actionInterval = setInterval(() => tg.tgSendAction(userId, "typing").catch(()=>{}), 4500);

        let currentStep = 0;
        if (!msgId) msgId = await tg.tgSend(userId, getProgressMessage(currentStep, 0, prefix, numToFetch));

        if (!state.sharedPage || state.sharedPage.isClosed()) {
            console.log("[DEBUG] Tab pertama kosong, initBrowser dipanggil...");
            const ok = await initBrowser();
            if (!ok) throw new Error("Browser gagal siap.");
        }

        const page = state.sharedPage;

        // === PASTIKAN TAB 1 DI TARGET_URL ===
        if (!page.url().includes('getnum')) {
            console.log(`[DEBUG] Navigasi ke TARGET_URL: ${config.TARGET_URL}`);
            await page.goto(config.TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        }

        // === ISI RANGE DAN KLIK GET NUMBER ===
        const INPUT_SELECTOR = "input[name='numberrange']";
        await page.waitForSelector(INPUT_SELECTOR, { timeout: 20000 });
        await page.click(INPUT_SELECTOR, { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.type(INPUT_SELECTOR, prefix);

        currentStep = 3;
        await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));

        const BUTTON_XPATH = "//button[contains(text(), 'Get Number')]";
        await page.waitForXPath(BUTTON_XPATH, { timeout: 20000 });
        for (let i = 0; i < numToFetch; i++) {
            await page.evaluate(sel => {
                const btn = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                if (btn) btn.click();
            }, BUTTON_XPATH);
            await page.waitForTimeout(400);
        }

        // === AMBIL NOMOR ===
        currentStep = 8;
        await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));

        let foundNumbers = [];
        const startTime = Date.now()/1000;
        while ((Date.now()/1000 - startTime) < 25) {
            foundNumbers = await getAllNumbersParallel(page, numToFetch);
            if (foundNumbers.length >= numToFetch) break;
            await new Promise(r => setTimeout(r, 1200));
        }

        if (foundNumbers.length === 0) {
            await tg.tgEdit(userId, msgId, "❌ <b>Gagal Mendapatkan Nomor.</b>\nRange kosong atau server sibuk.");
            return;
        }

        currentStep = 12;
        await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));

        const mainCountry = foundNumbers[0].country || "UNKNOWN";
        const emoji = config.COUNTRY_EMOJI?.[mainCountry] || "📞";

        let msg = `✅ <b>Numbers Ready!</b>\n\n`;
        foundNumbers.slice(0, numToFetch).forEach(entry => {
            msg += `📱 <code>${entry.number}</code>\n`;
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
        console.log("[DEBUG] Nomor dikirim ke Telegram");

    } catch (e) {
        console.error("[SCRAPER ERROR]", e);
        if (msgId) await tg.tgEdit(userId, msgId, `❌ <b>Error:</b> ${e.message}`);
    } finally {
        if (actionInterval) clearInterval(actionInterval);
        console.log("[DEBUG] processUserInput selesai");
    }
}

module.exports = { initBrowser, processUserInput, getProgressMessage };
