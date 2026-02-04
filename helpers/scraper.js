const puppeteer = require('puppeteer-core'); // Ganti ke puppeteer-core
const config = require('../config');
const { performLogin } = require('../login.js'); 
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
    const filledCount = Math.ceil(progressRatio * config.BAR.MAX_LENGTH);
    const emptyCount = config.BAR.MAX_LENGTH - filledCount;
    const bar = config.BAR.FILLED.repeat(filledCount) + config.BAR.EMPTY.repeat(emptyCount);

    let status = config.STATUS_MAP[currentStep];
    if (!status) {
        if (currentStep < 3) status = config.STATUS_MAP[0];
        else if (currentStep < 5) status = config.STATUS_MAP[4];
        else if (currentStep < 8) status = config.STATUS_MAP[5];
        else if (currentStep < 12) status = config.STATUS_MAP[8];
        else status = config.STATUS_MAP[12];
    }

    return `<code>${status}</code>\n<blockquote>Range: <code>${prefixRange}</code> | Jumlah: <code>${numCount}</code></blockquote>\n<code>Load:</code> [${bar}]`;
}

// --- Browser Control ---

async function initBrowser() {
    if (state.browser) {
        try { await state.browser.close(); } catch(e){}
    }
    
    console.log("[BROWSER] Launching Chromium (Puppeteer) in Termux...");
    state.browser = await puppeteer.launch({
        executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
        headless: true,
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
    
    // Set User Agent Manual di Puppeteer
    await state.sharedPage.setUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

    try {
        // Pastikan login.js juga sudah disesuaikan ke Puppeteer
        await performLogin(state.sharedPage, config.STEX_EMAIL, config.STEX_PASSWORD, config.LOGIN_URL);
        console.log("[BROWSER] Login Success. Redirecting to GetNum...");
        await state.sharedPage.goto(config.TARGET_URL, { waitUntil: 'networkidle2' });
        console.log("[BROWSER] Ready on Target URL.");
    } catch (e) {
        console.error(`[BROWSER ERROR] Login Failed: ${e.message}`);
    }
}

async function getNumberAndCountryFromRow(rowSelector, page) {
    try {
        // Puppeteer menggunakan evaluate untuk mengambil data dari DOM
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
        if (data.statusText.includes("success") || data.statusText.includes("failed")) return null;

        const number = normalizeNumber(data.numberRaw);
        if (db.isInCache(number)) return null;

        if (number.length > 5) return { number, country: data.country, status: data.statusText };
        return null;

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

// --- Main Action Logic ---

async function actionTask(userId) {
    return setInterval(() => {
        tg.tgSendAction(userId, "typing");
    }, 4500);
}

async function processUserInput(userId, prefix, clickCount, usernameTg, firstNameTg, messageIdToEdit = null) {
    let msgId = messageIdToEdit || state.pendingMessage[userId];
    let actionInterval = null;
    const numToFetch = clickCount;

    if (playwrightLock.isLocked()) {
        if (!msgId) {
            msgId = await tg.tgSend(userId, getProgressMessage(0, 0, prefix, numToFetch));
        } else {
            await tg.tgEdit(userId, msgId, getProgressMessage(0, 0, prefix, numToFetch));
        }
    }

    const release = await playwrightLock.acquire();
    try {
        actionInterval = await actionTask(userId);
        let currentStep = 0;
        const startOpTime = Date.now() / 1000;

        if (!msgId) {
            msgId = await tg.tgSend(userId, getProgressMessage(currentStep, 0, prefix, numToFetch));
        }

        if (!state.sharedPage || state.sharedPage.isClosed()) {
             await initBrowser();
        }

        const page = state.sharedPage;
        const INPUT_SELECTOR = "input[name='numberrange']";
        
        try {
            await page.waitForSelector(INPUT_SELECTOR, { visible: true, timeout: 15000 });
            
            // Puppeteer mengisi input: klik dulu, hapus, baru ketik
            await page.click(INPUT_SELECTOR, { clickCount: 3 }); 
            await page.keyboard.press('Backspace');
            await page.type(INPUT_SELECTOR, prefix);
            
            currentStep = 1;
            await new Promise(r => setTimeout(r, 800));
            currentStep = 2;

            const BUTTON_SELECTOR = "//button[contains(text(), 'Get Number')]";
            // Tunggu button muncul
            await page.waitForSelector('xpath/' + BUTTON_SELECTOR, { visible: true, timeout: 10000 });

            for (let i = 0; i < clickCount; i++) {
                // Gunakan evaluate untuk klik yang lebih stabil di Termux
                await page.evaluate((sel) => {
                    const btn = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    if (btn) btn.click();
                }, BUTTON_SELECTOR);
                await new Promise(r => setTimeout(r, 300)); 
            }

            currentStep = 3;
            await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));
            // ... (logika step progres tetap sama) ...

            // --- Bagian Scanning Nomor ---
            const rounds = [5.0, 5.0];
            let foundNumbers = [];

            for (let rIdx = 0; rIdx < rounds.length; rIdx++) {
                if (rIdx === 1 && foundNumbers.length < numToFetch) {
                    await page.evaluate((sel) => {
                        const btn = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                        if (btn) btn.click();
                    }, BUTTON_SELECTOR);
                    await new Promise(r => setTimeout(r, 2000));
                    currentStep = 8;
                }

                const startTime = Date.now() / 1000;
                while ((Date.now() / 1000 - startTime) < rounds[rIdx]) {
                    foundNumbers = await getAllNumbersParallel(page, numToFetch);
                    if (foundNumbers.length >= numToFetch) {
                        currentStep = 12;
                        break;
                    }
                    await new Promise(r => setTimeout(r, 600));
                }
                if (foundNumbers.length >= numToFetch) break;
            }

            // --- Output Akhir ---
            if (!foundNumbers || foundNumbers.length === 0) {
                await tg.tgEdit(userId, msgId, "❌ NOMOR TIDAK DITEMUKAN. Coba lagi.");
                return;
            }

            const mainCountry = foundNumbers[0].country || "UNKNOWN";
            currentStep = 12;
            await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));

            foundNumbers.forEach(entry => {
                db.saveCache({ number: entry.number, country: entry.country, user_id: userId, time: Date.now() });
                db.addToWaitList(entry.number, userId, usernameTg, firstNameTg);
            });

            const emoji = config.COUNTRY_EMOJI[mainCountry] || "🏳️";
            let msg = `✅ Number ready\n\n`;
            foundNumbers.slice(0, numToFetch).forEach((entry, idx) => {
                msg += `📞 <code>${entry.number}</code>\n`;
            });
            msg += `\n${emoji} ${mainCountry} | Range: <code>${prefix}</code>`;

            const inlineKb = {
                inline_keyboard: [
                    [{ text: "🔄 Change 1", callback_data: `change_num:1:${prefix}` }],
                    [{ text: "🔐 OTP Grup", url: config.GROUP_LINK_1 }, { text: "🌐 New Range", callback_data: "getnum" }]
                ]
            };

            await tg.tgEdit(userId, msgId, msg, inlineKb);

        } catch (e) {
            console.error(e);
            await tg.tgEdit(userId, msgId, `❌ Error: ${e.message}`);
        }
    } finally {
        if (actionInterval) clearInterval(actionInterval);
        release();
    }
}

module.exports = { initBrowser, processUserInput, getProgressMessage };
