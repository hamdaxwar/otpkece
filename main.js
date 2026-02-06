require('dotenv').config();
const cron = require('node-cron');
const db = require('./helpers/database');
const tg = require('./helpers/telegram');
const scraper = require('./helpers/scraper');
const state = require('./helpers/state'); 
const commands = require('./handlers/commands');
const callbacks = require('./handlers/callbacks');

const playwrightLock = state.browserLock;

console.log("[DEBUG] STEX_EMAIL dari ENV:", process.env.STEX_EMAIL ? "TERISI" : "KOSONG!");

// ================== MONITOR EXPIRY ==================
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
                if (now - item.timestamp > 1200) { 
                    const msgId = await tg.tgSend(item.user_id, `⚠️ Nomor <code>${item.number}</code> telah kadaluarsa.`);
                    if (msgId) setTimeout(() => tg.tgDelete(item.user_id, msgId), 30000);
                } else {
                    updatedList.push(item);
                }
            }

            db.saveWaitList(updatedList);
        } catch (e) {
            console.error("[EXPIRY MONITOR ERROR]", e.message);
        }
    }, 15000);
}

// ================== TELEGRAM LOOP ==================
async function telegramLoop() {
    let offset = 0;
    console.log("[TELEGRAM] Polling dimulai...");

    while (true) {
        try {
            const data = await tg.tgGetUpdates(offset);
            if (data && data.result) {
                for (const upd of data.result) {
                    offset = upd.update_id + 1;

                    if (upd.message) {
                        const chatId = upd.message.from.id;
                        console.log(`[TELEGRAM] Update dari ${chatId}: ${upd.message.text || '[no text]'}`);
                        
                        if (!state.users) state.users = {};
                        if (!state.users[chatId]) state.users[chatId] = { waitingAdminInput: false };

                        await commands.processCommand(upd.message);
                    }
                    if (upd.callback_query) {
                        console.log(`[TELEGRAM] Callback query dari ${upd.callback_query.from.id}`);
                        await callbacks.processCallback(upd.callback_query);
                    }
                }
            }
        } catch (e) {
            console.error("[TELEGRAM POLLING ERROR]", e.message);
            await new Promise(r => setTimeout(r, 5000));
        }
        await new Promise(r => setTimeout(r, 1000));
    }
}

// ================== MAIN ==================
async function main() {
    console.log("[INFO] Menjalankan NodeJS Bot Modular...");
    db.initializeFiles();

    try {
        require('./sms.js');
    } catch (e) {
        console.error("[ERROR] Gagal memuat sms.js:", e.message);
    }

    console.log("[INFO] Login browser dimulai...");
    await scraper.initBrowser(); 

    console.log("=================================");
    console.log("🚀 Menjalankan sistem otomatis...");
    
    // Langsung muat file pendukung
    try {
        require('./range.js');
        require('./message.js');
    } catch (e) {
        console.error("[ERROR] Gagal memuat range/message.js:", e.message);
    }

    // Jalankan loop telegram dan monitor secara paralel
    telegramLoop();
    expiryMonitorTask();
    
    console.log("✅ Semua sistem sudah berjalan otomatis.");
    console.log("=================================");

    // ================== CRON RESTART BROWSER ==================
    cron.schedule('0 7 * * *', async () => {
        console.log("[CRON] Merestart browser...");
        const release = await playwrightLock.acquire();
        try {
            await scraper.initBrowser();
        } finally {
            release();
        }
    }, { scheduled: true, timezone: "Asia/Jakarta" });
}

main();
