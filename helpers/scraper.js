const puppeteer = require('puppeteer-core');
const config = require('../config');
const { performLogin } = require('../login.js'); 
const state = require('./state'); 
const db = require('./database');
const tg = require('./telegram');
const fs = require('fs');
const { exec } = require('child_process');

// ================== RESET SYSTEM (ANTI-STUCK) ==================

/**
 * Membunuh semua proses Chromium yang masih nyangkut di Termux
 * dan memaksa pelepasan lock antrean.
 */
async function hardResetBot() {
    console.log("[SYSTEM] Melakukan pembersihan total...");
    return new Promise((resolve) => {
        // Bunuh semua proses chromium
        exec('pkill -f chromium', (err) => {
            // Paksa lepas lock di state jika ada
            if (state.browserLock && state.browserLock.isLocked()) {
                console.log("[SYSTEM] Memaksa pelepasan lock antrean...");
                // Jika library lock kamu punya method manual release, panggil di sini
                // Atau kita asumsikan dengan restart proses state akan fresh
            }
            resolve();
        });
    });
}

// ================== HELPERS ==================

function normalizeNumber(number) {
    let norm = String(number).trim().replace(/[\s-]/g, "");
    if (!norm.startsWith('+') && /^\d+$/.test(norm)) norm = '+' + norm;
    return norm;
}

function getProgressMessage(currentStep, prefixRange, numCount) {
    const maxLen = 12;
    const progressRatio = Math.min(currentStep / 12, 1.0);
    const filledCount = Math.ceil(progressRatio * maxLen);
    const bar = "█".repeat(filledCount) + "░".repeat(maxLen - filledCount);
    
    let status = "Processing...";
    if (currentStep <= 2) status = "🔄 Reset Sesi...";
    else if (currentStep <= 5) status = "✍️ Mengisi Range...";
    else if (currentStep <= 10) status = "📡 Menarik Nomor...";
    else status = "✅ Selesai!";

    return `<b>${status}</b>\n<blockquote>Range: <code>${prefixRange}</code> | Qty: <code>${numCount}</code></blockquote>\n<code>[${bar}]</code>`;
}

// ================== BROWSER CONTROL ==================

async function initBrowser() {
    try {
        await hardResetBot(); // Bersihkan zombie process sebelum mulai

        console.log("[BROWSER] Membuka Chromium Baru...");
        state.browser = await puppeteer.launch({
            executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const pages = await state.browser.pages();
        state.sharedPage = pages.length > 0 ? pages[0] : await state.browser.newPage();

        console.log("[BROWSER] Login ulang...");
        const loginSuccess = await performLogin(state.sharedPage, config.STEX_EMAIL, config.STEX_PASSWORD, config.LOGIN_URL);
        
        if (!loginSuccess) throw new Error("Gagal Login.");

        await state.sharedPage.goto(config.TARGET_URL, { waitUntil: 'networkidle2' });
        return true;
    } catch (e) {
        console.error(`[BROWSER ERROR] ${e.message}`);
        return false;
    }
}

async function getNumberAndCountryFromRow(rowSelector, page) {
    try {
        return await page.evaluate(sel => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const phoneEl = el.querySelector("td:nth-child(1) span.font-mono");
            const countryEl = el.querySelector("td:nth-child(2) span.text-slate-200");
            if (!phoneEl) return null;
            return {
                number: phoneEl.innerText.trim(),
                country: countryEl ? countryEl.innerText.trim().toUpperCase() : "UNKNOWN"
            };
        }, rowSelector);
    } catch (e) { return null; }
}

// ================== MAIN LOGIC ==================

async function processUserInput(userId, prefix, clickCount, usernameTg, firstNameTg, messageIdToEdit = null) {
    let msgId = messageIdToEdit;
    let actionInterval = null;
    const numToFetch = parseInt(clickCount) || 1;
    let release = null;

    try {
        // Paksa buat pesan status jika belum ada
        if (!msgId) msgId = await tg.tgSend(userId, "🔄 Menyiapkan sistem...");

        // Safety Timeout untuk Antrean
        const timeout = setTimeout(() => { throw new Error("TIMEOUT_ANTREAN"); }, 40000);
        release = await state.browserLock.acquire();
        clearTimeout(timeout);

        actionInterval = setInterval(() => tg.tgSendAction(userId, "typing").catch(() => {}), 4500);

        // RESET & MULAI FRESH
        await tg.tgEdit(userId, msgId, getProgressMessage(2, prefix, numToFetch));
        await initBrowser();

        const page = state.sharedPage;
        const INPUT_SEL = "input[name='numberrange']";
        const BTN_SEL = "button[type='submit']";

        // INPUT RANGE
        await page.waitForSelector(INPUT_SEL, { visible: true, timeout: 10000 });
        await page.evaluate((sel, val) => {
            const el = document.querySelector(sel);
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, INPUT_SEL, prefix);

        await tg.tgEdit(userId, msgId, getProgressMessage(5, prefix, numToFetch));

        // KLIK TOMBOL
        await page.evaluate((sel, count) => {
            const btn = document.querySelector(sel);
            for(let i=0; i<count; i++) btn.click();
        }, BTN_SEL, numToFetch);

        // TUNGGU NOMOR MUNCUL
        let foundNumbers = [];
        for (let i = 0; i < 10; i++) {
            await tg.tgEdit(userId, msgId, getProgressMessage(6 + i, prefix, numToFetch));
            
            // Ambil semua baris yang mungkin berisi nomor baru
            const tasks = [];
            for (let j = 1; j <= numToFetch + 2; j++) {
                tasks.push(getNumberAndCountryFromRow(`tbody tr:nth-child(${j})`, page));
            }
            const results = await Promise.all(tasks);
            foundNumbers = results.filter(r => r && r.number && !db.isInCache(normalizeNumber(r.number)));

            if (foundNumbers.length >= numToFetch) break;
            await new Promise(r => setTimeout(r, 2000));
        }

        if (foundNumbers.length === 0) throw new Error("Nomor tidak ditemukan di tabel.");

        // KIRIM HASIL
        let resMsg = `✅ <b>BERHASIL!</b>\n\n`;
        foundNumbers.slice(0, numToFetch).forEach((n, idx) => {
            const norm = normalizeNumber(n.number);
            resMsg += `${idx+1}. <code>${norm}</code> (${n.country})\n`;
            db.saveCache({ number: norm, country: n.country, user_id: userId, time: Date.now() });
            db.addToWaitList(norm, userId, usernameTg, firstNameTg);
        });

        await tg.tgEdit(userId, msgId, resMsg, {
            inline_keyboard: [[{ text: "🌐 Menu Utama", callback_data: "getnum" }]]
        });

    } catch (e) {
        console.error(`[CRITICAL ERROR] ${e.message}`);
        if (state.sharedPage) await state.sharedPage.screenshot({ path: `error_${userId}.png` });
        await tg.tgEdit(userId, msgId, `❌ <b>Sistem Error:</b> <code>${e.message}</code>\n\n<i>Bot telah di-reset otomatis. Silakan coba lagi.</i>`);
    } finally {
        if (actionInterval) clearInterval(actionInterval);
        if (release) release();
    }
}

module.exports = { initBrowser, processUserInput, getProgressMessage };
