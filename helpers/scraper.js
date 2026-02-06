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
        if (currentStep < 3) status = "Memasukkan Range...";
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
                '--single-process'
            ]
        });

        const pages = await state.browser.pages();
        state.sharedPage = pages.length > 0 ? pages[0] : await state.browser.newPage();

        console.log("[BROWSER] Mencoba Login...");
        const loginSuccess = await performLogin(state.sharedPage, config.STEX_EMAIL, config.STEX_PASSWORD, config.LOGIN_URL);
        
        if (!loginSuccess) throw new Error("Gagal Login ke Website.");

        await state.sharedPage.goto(config.TARGET_URL, { waitUntil: 'networkidle2' });
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

// ================== MAIN ACTION LOGIC ==================

async function processUserInput(userId, prefix, clickCount, usernameTg, firstNameTg, messageIdToEdit = null) {
    let msgId = messageIdToEdit || (state.pendingMessage ? state.pendingMessage[userId] : null);
    let actionInterval = null;
    const numToFetch = parseInt(clickCount) || 1;

    // Antrian Lock
    const release = await state.browserLock.acquire();
    console.log(`[JOB] User ${userId} | Range: ${prefix}`);

    try {
        actionInterval = setInterval(() => tg.tgSendAction(userId, "typing").catch(() => {}), 4500);
        let currentStep = 0;

        if (!msgId) msgId = await tg.tgSend(userId, getProgressMessage(currentStep, 0, prefix, numToFetch));

        if (!state.browser || !state.sharedPage || state.sharedPage.isClosed()) {
             await initBrowser();
        }

        const page = state.sharedPage;
        const INPUT_SEL = "input[name='numberrange']";
        const BTN_SEL = "button[type='submit']";

        // 1. Masukkan Range via DOM (Lebih kuat dari page.type)
        await page.waitForSelector(INPUT_SEL, { visible: true, timeout: 15000 });
        
        await page.evaluate((sel, val) => {
            const input = document.querySelector(sel);
            input.value = val;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }, INPUT_SEL, prefix);

        console.log(`[DEBUG] Input terisi: ${prefix}`);
        currentStep = 3;
        await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));

        // 2. Klik Tombol "Get Number" via DOM
        const clickSuccess = await page.evaluate((sel, count) => {
            const btn = document.querySelector(sel);
            if (btn && btn.innerText.includes('Get Number')) {
                for (let i = 0; i < count; i++) {
                    btn.click();
                }
                return true;
            }
            return false;
        }, BTN_SEL, numToFetch);

        if (!clickSuccess) {
            console.log("[DEBUG] Click DOM gagal, mencoba click standar...");
            await page.click(BTN_SEL);
        }

        // 3. Scan Hasil
        let foundNumbers = [];
        const maxWait = 25; 
        const startTime = Date.now() / 1000;

        while ((Date.now() / 1000 - startTime) < maxWait) {
            foundNumbers = await getAllNumbersParallel(page, numToFetch);
            if (foundNumbers.length >= numToFetch) break;

            if (currentStep < 11) {
                currentStep++;
                await tg.tgEdit(userId, msgId, getProgressMessage(currentStep, 0, prefix, numToFetch));
            }
            await new Promise(r => setTimeout(r, 1500));
        }

        if (foundNumbers.length === 0) {
            // Screenshot untuk debug jika gagal
            await page.screenshot({ path: `empty_${userId}.png` });
            await tg.tgEdit(userId, msgId, `❌ <b>Nomor Tidak Ditemukan.</b>\nRange <code>${prefix}</code> kosong atau sistem lambat.`);
            return;
        }

        // 4. Sukses & Kirim
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
            inline_keyboard: [[{ text: "🌐 Menu Utama", callback_data: "getnum" }]]
        };

        await tg.tgEdit(userId, msgId, msg, inlineKb);

    } catch (e) {
        console.error(`[ERROR] ${e.message}`);
        if (state.sharedPage) await state.sharedPage.screenshot({ path: `error_${userId}.png` });
        if (msgId) await tg.tgEdit(userId, msgId, `❌ <b>Error:</b> <code>${e.message}</code>`);
    } finally {
        if (actionInterval) clearInterval(actionInterval);
        release();
    }
}

module.exports = { initBrowser, processUserInput, getProgressMessage };
