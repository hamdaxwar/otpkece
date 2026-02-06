const puppeteer = require('puppeteer-core');
const config = require('../config');
const { performLogin } = require('../login.js'); 
const state = require('./state'); 
const db = require('./database');
const tg = require('./telegram');
const fs = require('fs');
const { exec } = require('child_process');

// ================== DEBUGGING TOOL ==================

async function sendDebugScreenshot(userId, caption = "📸 Live Debug View") {
    try {
        if (state.sharedPage) {
            const path = `./debug_${userId}.png`;
            await state.sharedPage.screenshot({ path, fullPage: true });
            await tg.tgSendPhoto(userId, path, caption);
            if (fs.existsSync(path)) fs.unlinkSync(path); // Hapus setelah kirim
        } else {
            await tg.tgSend(userId, "❌ Browser sedang tidak aktif.");
        }
    } catch (e) {
        console.error("Gagal ambil screenshot:", e.message);
    }
}

// ================== RESET & CLEANING ==================

async function hardResetBot() {
    console.log("[SYSTEM] Cleaning zombie processes...");
    return new Promise((resolve) => {
        exec('pkill -f chromium', () => {
            console.log("[SYSTEM] Reset Berhasil.");
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
    if (currentStep <= 2) status = "🔄 Memulai Browser...";
    else if (currentStep <= 5) status = "✍️ Mengisi Data...";
    else if (currentStep <= 10) status = "📡 Menarik Nomor...";
    else status = "✅ Selesai!";

    return `<b>${status}</b>\n<blockquote>Range: <code>${prefixRange}</code>\nQty: <code>${numCount}</code></blockquote>\n<code>[${bar}]</code>`;
}

// ================== BROWSER CORE ==================

async function initBrowser(userId) {
    try {
        await hardResetBot();
        state.browser = await puppeteer.launch({
            executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process']
        });

        const pages = await state.browser.pages();
        state.sharedPage = pages.length > 0 ? pages[0] : await state.browser.newPage();

        console.log("[BROWSER] Login process...");
        const loginSuccess = await performLogin(state.sharedPage, config.STEX_EMAIL, config.STEX_PASSWORD, config.LOGIN_URL);
        
        if (!loginSuccess) {
            await sendDebugScreenshot(userId, "❌ Gagal Login - Lihat Gambar");
            throw new Error("Gagal Login ke Website.");
        }

        await state.sharedPage.goto(config.TARGET_URL, { waitUntil: 'networkidle2' });
        return true;
    } catch (e) {
        console.error(`[INIT ERROR] ${e.message}`);
        return false;
    }
}

// ================== MAIN PROCESS ==================

async function processUserInput(userId, arg1, arg2, usernameTg, firstNameTg, messageIdToEdit = null) {
    let msgId = messageIdToEdit;
    let actionInterval = null;
    let release = null;

    // Proteksi Variabel Terbalik
    // Jika arg1 lebih pendek dari arg2, berarti arg1 adalah jumlah, arg2 adalah prefix.
    let prefix = String(arg1).length > String(arg2).length ? arg1 : arg2;
    let clickCount = String(arg1).length > String(arg2).length ? arg2 : arg1;
    const numToFetch = Math.min(parseInt(clickCount) || 1, 10);

    try {
        if (!msgId) msgId = await tg.tgSend(userId, "⏳ Menyiapkan Sesi Fresh...");

        // Safety Antrean
        const timeout = setTimeout(() => { throw new Error("ANTREAN_PENUH"); }, 45000);
        release = await state.browserLock.acquire();
        clearTimeout(timeout);

        actionInterval = setInterval(() => tg.tgSendAction(userId, "typing").catch(() => {}), 4500);

        // 1. Jalankan Browser
        await tg.tgEdit(userId, msgId, getProgressMessage(2, prefix, numToFetch));
        const ready = await initBrowser(userId);
        if (!ready) throw new Error("Gagal inisialisasi browser.");

        const page = state.sharedPage;
        const INPUT_SEL = "input[name='numberrange']";
        const BTN_SEL = "button[type='submit']";

        // 2. Isi Input via DOM (Anti-Gagal)
        await page.waitForSelector(INPUT_SEL, { visible: true, timeout: 10000 });
        await page.evaluate((sel, val) => {
            const el = document.querySelector(sel);
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }, INPUT_SEL, prefix);

        await tg.tgEdit(userId, msgId, getProgressMessage(5, prefix, numToFetch));

        // 3. Klik Tombol via DOM
        await page.evaluate((sel, count) => {
            const btn = document.querySelector(sel);
            if (btn) {
                for(let i=0; i<count; i++) btn.click();
            }
        }, BTN_SEL, numToFetch);

        // 4. Scan Hasil
        let foundNumbers = [];
        for (let i = 0; i < 15; i++) {
            await tg.tgEdit(userId, msgId, getProgressMessage(6 + i, prefix, numToFetch));
            
            foundNumbers = await page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('tbody tr'));
                return rows.map(row => {
                    const phone = row.querySelector("td:nth-child(1) span.font-mono");
                    const country = row.querySelector("td:nth-child(2) span.text-slate-200");
                    return phone ? { number: phone.innerText.trim(), country: country ? country.innerText.trim() : "UN" } : null;
                }).filter(r => r !== null);
            });

            // Filter nomor yang belum ada di cache
            foundNumbers = foundNumbers.filter(n => !db.isInCache(normalizeNumber(n.number)));

            if (foundNumbers.length >= numToFetch) break;
            await new Promise(r => setTimeout(r, 2000));
        }

        if (foundNumbers.length === 0) {
            await sendDebugScreenshot(userId, "❓ Nomor Tidak Muncul - Cek Web");
            throw new Error("Nomor tidak ditemukan.");
        }

        // 5. Sukses
        let resMsg = `✅ <b>BERHASIL!</b>\n\n`;
        foundNumbers.slice(0, numToFetch).forEach((n, idx) => {
            const norm = normalizeNumber(n.number);
            resMsg += `${idx+1}. <code>${norm}</code> (${n.country.toUpperCase()})\n`;
            db.saveCache({ number: norm, country: n.country, user_id: userId, time: Date.now() });
            db.addToWaitList(norm, userId, usernameTg, firstNameTg);
        });

        await tg.tgEdit(userId, msgId, resMsg, {
            inline_keyboard: [[{ text: "🌐 Menu Utama", callback_data: "getnum" }]]
        });

    } catch (e) {
        console.error(`[FINAL ERROR] ${e.message}`);
        await tg.tgEdit(userId, msgId, `❌ <b>Error:</b> <code>${e.message}</code>\n\nGunakan /cek untuk melihat layar.`);
    } finally {
        if (actionInterval) clearInterval(actionInterval);
        if (release) release();
    }
}

module.exports = { initBrowser, processUserInput, getProgressMessage, sendDebugScreenshot };
