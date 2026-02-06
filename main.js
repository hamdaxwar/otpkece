require('dotenv').config();
const cron = require('node-cron');
const db = require('./helpers/database');
const tg = require('./helpers/telegram');
const scraper = require('./helpers/scraper');
const commands = require('./handlers/commands');
const callbacks = require('./handlers/callbacks');

// Debug ENV
console.log("[DEBUG] STEX_EMAIL:", process.env.STEX_EMAIL ? "TERISI" : "KOSONG!");

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
        } catch (e) {}
    }, 15000);
}

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
            await new Promise(r => setTimeout(r, 5000));
        }

        await new Promise(r => setTimeout(r, 1000));
    }
}

async function main() {
    console.log("[INFO] Menjalankan Bot...");
    db.initializeFiles();

    // modul monitor
    require('./range.js');
    require('./message.js');
    require('./sms.js');

    // cron refresh browser (optional)
    cron.schedule('0 7 * * *', async () => {
        try {
            console.log("[CRON] Restart browser...");
            await scraper.initBrowser(true);
        } catch (e) {}
    }, { timezone: "Asia/Jakarta" });

    try {
        await scraper.initBrowser(); // launch browser
        await Promise.all([
            telegramLoop(),
            expiryMonitorTask()
        ]);
    } catch (e) {
        console.error("[FATAL ERROR]", e.message);
    }
}

main();
