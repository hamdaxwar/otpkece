const puppeteer = require('puppeteer-core');
const config = require('../config');
const { performLogin } = require('../login.js'); 
const state = require('./state'); 
const db = require('./database');
const tg = require('./telegram');

// --- Helper Functions ---

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
    
    console.log("[BROWSER] Launching Puppeteer-Core (Chromium Termux)...");
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

    const pages = await state.browser.pages();
    state.sharedPage = pages.length > 0 ? pages[0] : await state.browser.newPage();

    try {
        await performLogin(state.sharedPage, config.STEX_EMAIL, config.STEX_PASSWORD, config.LOGIN_URL);
        console.log("[BROWSER] Login Success.");
        await state.sharedPage.goto(config.TARGET_URL, { waitUntil: 'domcontentloaded' });
    } catch (e) {
        console.error(`[BROWSER ERROR] Login Failed: ${e.message}`);
    }
}

async function getNumberAndCountryFromRow(rowSelector, page) {
    try {
        const row = await page.$(rowSelector);
        if (!row) return null;

        const data = await page.evaluate(el => {
            const phoneEl = el.querySelector("td:nth-child(1) span.font-mono");
            const statusEl = el.querySelector("td:nth-child(1) div:nth-child(2) span");
            const countryEl = el.querySelector("td:nth-child(2) span.text-slate-200");
            
            return {
                numberRaw: phoneEl ? phoneEl.innerText : null,
                statusText: statusEl ? statusEl.innerText.toLowerCase() : "unknown",
                countryRaw: countryEl ? countryEl.innerText.trim().toUpperCase() : "UNKNOWN"
            };
        }, row);

        const number = data.numberRaw ? normalizeNumber(data.numberRaw) : null;
        if (!number || db.isInCache(number)) return null;
        if (data.statusText.includes("success") || data.statusText.includes("failed")) return null;

        if (number && number.length > 5) {
            return { number, country: data.countryRaw, status: data.statusText };
        }
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

async function processUserInput(userId, prefix, clickCount, usernameTg, firstNameTg, messageIdToEdit = null) {
    let msgId = messageIdToEdit || state.pendingMessage[userId];
    let actionInterval = null;
    const numToFetch = clickCount;

    if (state.browserLock.isLocked()) {
        const waitMsg = getProgressMessage(0, 0, prefix, numToFetch);
        if (!msgId) {
            msgId = await tg.tgSend(userId, waitMsg);
            state.pendingMessage[userId] = msgId;
        } else {
            await tg.tgEdit(userId, msgId, waitMsg);
        }
    }

    const release = await state.browserLock.acquire();
    try {
        actionInterval = setInterval(() => tg.tgSendAction(userId, "typing"), 4500);
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
        
        await page.waitForSelector(INPUT_SELECTOR, { visible: true, timeout: 10000 });
        await page.click(INPUT_SELECTOR, { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.type(INPUT_SELECTOR, prefix);
        
        currentStep = 2;
        await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));

        // Cari & Klik Button
        const getNumBtn = await page.evaluateHandle(() => {
            return Array.from(document.querySelectorAll('button')).find(el => el.innerText.includes('Get Number'));
        });

        if (getNumBtn) {
            for (let i = 0; i < clickCount; i++) {
                await getNumBtn.asElement().click();
                await new Promise(r => setTimeout(r, 200));
            }
        }

        let foundNumbers = [];
        const rounds = [5.0, 5.0]; // Delay logic sesuai kode asal

        for (let rIdx = 0; rIdx < rounds.length; rIdx++) {
            const duration = rounds[rIdx];
            if (rIdx === 1 && foundNumbers.length < numToFetch) {
                if (getNumBtn) await getNumBtn.asElement().click();
                currentStep = 8;
            }

            const startTime = Date.now() / 1000;
            while ((Date.now() / 1000 - startTime) < duration) {
                foundNumbers = await getAllNumbersParallel(page, numToFetch);
                if (foundNumbers.length >= numToFetch) {
                    currentStep = 12;
                    break;
                }
                // Animasi Progress Bar
                const elapsedTime = (Date.now() / 1000) - startOpTime;
                const targetStep = Math.floor(12 * elapsedTime / 14);
                if (targetStep > currentStep && targetStep < 12) {
                    currentStep = targetStep;
                    await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));
                }
                await new Promise(r => setTimeout(r, 500));
            }
            if (foundNumbers.length >= numToFetch) break;
        }

        if (foundNumbers.length === 0) {
            await tg.tgEdit(userId, msgId, "❌ NOMOR TIDAK DI TEMUKAN. Coba lagi atau ganti range.");
            return;
        }

        const mainCountry = foundNumbers[0].country || "UNKNOWN";
        currentStep = 12;
        await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));

        foundNumbers.forEach(entry => {
            db.saveCache({ number: entry.number, country: entry.country, user_id: userId, time: Date.now() });
            db.addToWaitList(entry.number, userId, usernameTg, firstNameTg);
        });

        state.lastUsedRange[userId] = prefix;
        const emoji = config.COUNTRY_EMOJI[mainCountry] || "🏴‍☠️";
        
        let msg = "";
        if (numToFetch === 10) {
            msg = "✅The number is already.\n\n<code>";
            foundNumbers.slice(0, 10).forEach(entry => msg += `${entry.number}\n`);
            msg += "</code>";
        } else {
            msg = "✅ The number is ready\n\n";
            if (numToFetch === 1) {
                msg += `📞 Number  : <code>${foundNumbers[0].number}</code>\n`;
            } else {
                foundNumbers.slice(0, numToFetch).forEach((entry, idx) => {
                    msg += `📞 Number ${idx+1} : <code>${entry.number}</code>\n`;
                });
            }
            msg += `${emoji} COUNTRY : ${mainCountry}\n` +
                   `🏷️ Range   : <code>${prefix}</code>\n\n` +
                   `<b>🤖 Number available please use, Waiting for OTP</b>\n`;
        }

        const inlineKb = {
            inline_keyboard: [
                [{ text: "🔄 Change 1 Number", callback_data: `change_num:1:${prefix}` }],
                [{ text: "🔄 Change 3 Number", callback_data: `change_num:3:${prefix}` }],
                [{ text: "🔐 OTP Grup", url: config.GROUP_LINK_1 }, { text: "🌐 Change Range", callback_data: "getnum" }]
            ]
        };

        await tg.tgEdit(userId, msgId, msg, inlineKb);

    } catch (e) {
        console.error(e);
        if (msgId) await tg.tgEdit(userId, msgId, `❌ Terjadi kesalahan fatal (${e.message}).`);
    } finally {
        if (actionInterval) clearInterval(actionInterval);
        release();
    }
}

module.exports = { initBrowser, processUserInput, getProgressMessage };
