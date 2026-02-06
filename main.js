require('dotenv').config();
const readline = require('readline');
const cron = require('node-cron');
const db = require('./helpers/database');
const tg = require('./helpers/telegram');
const scraper = require('./helpers/scraper');
const { playwrightLock } = scraper;
const commands = require('./handlers/commands');
const callbacks = require('./handlers/callbacks');

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
    try { await tg.tgGetUpdates(-1); } catch (e) {}
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

    // sms.js tetap jalan (tidak buka tab)
    require('./sms.js');

    console.log("[INFO] Login browser dimulai...");
    await scraper.initBrowser(); // login.js handle semua status & screenshot

    console.log("=================================");
    console.log("ketik y untuk menjalankan range.js & message.js");
    console.log("> ");

    // ================== PROMPT TERMINAL ==================
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.on('line', async (input) => {
        if (input.trim().toLowerCase() === 'y') {
            console.log("🚀 Menjalankan range.js & message.js...");
            require('./range.js');
            require('./message.js');

            // jalankan telegram loop + expiry monitor bersamaan
            await Promise.all([telegramLoop(), expiryMonitorTask()]);
            rl.close();
        } else {
            console.log("ketik y untuk lanjut...");
            process.stdout.write("> ");
        }
    });

    // ================== CRON RESTART BROWSER ==================
    cron.schedule('0 7 * * *', async () => {
        const release = await playwrightLock.acquire();
        try {
            await scraper.initBrowser();
        } finally {
            release();
        }
    }, { scheduled: true, timezone: "Asia/Jakarta" });
}

main();
