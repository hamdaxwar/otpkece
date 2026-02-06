require('dotenv').config();
const readline = require('readline');
const cron = require('node-cron');
const config = require('./config');
const db = require('./helpers/database');
const tg = require('./helpers/telegram');
const scraper = require('./helpers/scraper');
const { state, playwrightLock } = require('./helpers/state');
const commands = require('./handlers/commands');
const callbacks = require('./handlers/callbacks');

console.log("[DEBUG] STEX_EMAIL dari ENV:", process.env.STEX_EMAIL ? "TERISI" : "KOSONG!");

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
    state.verifiedUsers = db.loadUsers();
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
    console.log("[INFO] Menjalankan NodeJS Bot Modular...");
    db.initializeFiles();

    // sms.js tetap jalan (tidak buka tab)
    require('./sms.js');

    console.log("[INFO] Login browser dimulai...");
    const loginResult = await scraper.initBrowser();

    // kirim status login ke admin + screenshot
    let statusText = loginResult.success ? "✅ LOGIN SUKSES" : "❌ LOGIN GAGAL";

    await tg.tgSend(process.env.ADMIN_ID, `🔐 Status Login Bot:\n${statusText}`).catch(()=>{});

    if (loginResult.screenshot) {
        await tg.tgSendPhoto(
            process.env.ADMIN_ID,
            loginResult.screenshot,
            "📸 Screenshot halaman setelah login"
        ).catch(()=>{});
    }

    console.log("=================================");
    console.log("STATUS LOGIN:", loginResult.success ? "SUKSES" : "GAGAL");
    console.log("ketik y untuk menjalankan range.js & message.js");
    console.log("> ");

    // prompt terminal
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.on('line', async (input) => {
        if (input.trim().toLowerCase() === 'y') {
            console.log("🚀 Menjalankan range.js & message.js...");
            require('./range.js');
            require('./message.js');

            await Promise.all([telegramLoop(), expiryMonitorTask()]);
            rl.close();
        } else {
            console.log("ketik y untuk lanjut...");
            process.stdout.write("> ");
        }
    });

    cron.schedule('0 7 * * *', async () => {
        const release = await playwrightLock.acquire();
        try { await scraper.initBrowser(); } finally { release(); }
    }, { scheduled: true, timezone: "Asia/Jakarta" });
}

main();
