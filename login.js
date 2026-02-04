require('dotenv').config(); 
const { fork } = require('child_process');
const cron = require('node-cron');
const config = require('./config');
const db = require('./helpers/database');
const tg = require('./helpers/telegram');
const scraper = require('./helpers/scraper');
const { state, playwrightLock } = require('./helpers/state');
const commands = require('./handlers/commands');
const callbacks = require('./handlers/callbacks');

// --- BARIS DEBUG YANG KAMU MINTA ---
console.log("-----------------------------------------");
console.log("DEBUG ENV EMAIL:", process.env.STEX_EMAIL);
console.log("DEBUG ENV ADMIN:", process.env.ADMIN_ID);
console.log("-----------------------------------------");

/**
 * Background Task: Monitor Kadaluarsa
 */
async function expiryMonitorTask() {
    setInterval(async () => {
        try {
            const waitList = db.loadWaitList();
            const now = Date.now() / 1000;
            const updatedList = [];
            for (const item of waitList) {
                if (item.otp_received_time) {
                    updatedList.push(item);
                    continue;
                }

                if (now - item.timestamp > 1200) { // 20 Menit
                    const msgId = await tg.tgSend(item.user_id, `⚠️ Nomor <code>${item.number}</code> telah kadaluarsa.`);
                    if (msgId) {
                        setTimeout(() => tg.tgDelete(item.user_id, msgId), 30000);
                    }
                } else {
                    updatedList.push(item);
                }
            }
            db.saveWaitList(updatedList);
        } catch (e) { /* silent error */ }
    }, 15000);
}

/**
 * Telegram Polling Loop
 */
async function telegramLoop() {
    state.verifiedUsers = db.loadUsers();
    let offset = 0;

    try {
        await tg.tgGetUpdates(-1);
    } catch (e) {}
    
    console.log("[TELEGRAM] Polling dimulai...");

    while (true) {
        try {
            const data = await tg.tgGetUpdates(offset);
            if (data && data.result) {
                for (const upd of data.result) {
                    offset = upd.update_id + 1;
                    if (upd.message) await commands.processCommand(upd.message);
                    if (upd.callback_query) await callbacks.processCallback(upd.callback_query);
                }
            }
        } catch (e) {
            if (e.response && e.response.status === 429) {
                const retryAfter = (e.response.data.parameters?.retry_after || 10) * 1000;
                await new Promise(r => setTimeout(r, retryAfter));
            } else {
                await new Promise(r => setTimeout(r, 5000));
            }
        }
        await new Promise(r => setTimeout(r, 1000));
    }
}

/**
 * MAIN FUNCTION
 */
async function main() {
    console.log("[INFO] Menjalankan NodeJS Bot Modular...");
    
    db.initializeFiles();
    
    console.log("[INFO] Mengaktifkan semua modul monitor...");
    require('./range.js'); 
    require('./message.js'); 
    require('./sms.js'); 

    cron.schedule('0 7 * * *', async () => {
        console.log("[CRON] Menyegarkan Sesi Browser...");
        const release = await playwrightLock.acquire();
        try {
            await scraper.initBrowser();
        } catch (e) {
            console.error("[CRON ERROR]", e.message);
        } finally {
            release();
        }
    }, {
        scheduled: true,
        timezone: "Asia/Jakarta"
    });

    try {
        await scraper.initBrowser();
        await Promise.all([
            telegramLoop(),
            expiryMonitorTask()
        ]);
    } catch (e) {
        console.error("[FATAL ERROR]", e.message);
    }
}

main();
