require('dotenv').config();
const db = require('./helpers/database');
const tg = require('./helpers/telegram');
const scraper = require('./helpers/scraper');
const state = require('./helpers/state'); 
const commands = require('./handlers/commands');
const callbacks = require('./handlers/callbacks');

// Impor script logika bisnis Anda di sini
// Pastikan file-file ini mengekspor fungsi atau menjalankan logikanya sendiri
const { startGetNum } = require('./getnum.js'); 

console.log("[DEBUG] STEX_EMAIL:", process.env.STEX_EMAIL ? "TERISI" : "KOSONG!");

/**
 * MONITOR EXPIRY
 * Memantau daftar tunggu dan menghapus yang sudah kadaluarsa (20 menit)
 */
async function expiryMonitorTask() {
    setInterval(async () => {
        try {
            const waitList = db.loadWaitList();
            const now = Date.now() / 1000;
            const updatedList = waitList.filter(item => {
                if (item.otp_received_time) return true;
                if (now - item.timestamp > 1200) {
                    tg.tgSend(item.user_id, `⚠️ Nomor <code>${item.number}</code> kadaluarsa.`);
                    return false;
                }
                return true;
            });
            db.saveWaitList(updatedList);
        } catch (e) {
            console.error("[EXPIRY MONITOR ERROR]", e.message);
        }
    }, 15000);
}

/**
 * TELEGRAM POLLING
 * Menangani interaksi pesan dan tombol dari user
 */
async function telegramLoop() {
    let offset = 0;
    console.log("[TELEGRAM] Polling dimulai...");

    while (true) {
        try {
            const data = await tg.tgGetUpdates(offset);
            if (data?.result) {
                for (const upd of data.result) {
                    offset = upd.update_id + 1;
                    if (upd.message) await commands.processCommand(upd.message);
                    if (upd.callback_query) await callbacks.processCallback(upd.callback_query);
                }
            }
        } catch (e) {
            console.error("[TELEGRAM ERROR]", e.message);
            await new Promise(r => setTimeout(r, 5000));
        }
        await new Promise(r => setTimeout(r, 1000));
    }
}

/**
 * MAIN RUNNER
 */
async function main() {
    console.log("🚀 Memulai Bootloader...");
    
    // 1. Inisialisasi Database
    db.initializeFiles();

    // 2. Jalankan Browser Scraper
    try {
        await scraper.initBrowser();
        console.log("✅ Browser siap.");
    } catch (e) {
        console.error("❌ Gagal inisialisasi browser:", e.message);
    }

    // 3. Jalankan Script Pendukung (getnum.js, sms.js, dll)
    try {
        // Jika getnum.js berupa fungsi:
        // startGetNum(); 
        
        // Jika getnum.js adalah script mandiri yang langsung jalan saat di-require:
        require('./getnum.js');
        require('./sms.js');
        require('./range.js');
        require('./message.js');
        
        console.log("✅ Script getnum & modul pendukung dimuat.");
    } catch (e) {
        console.error("❌ Gagal memuat script:", e.message);
    }

    // 4. Jalankan Background Tasks
    telegramLoop();
    expiryMonitorTask();

    console.log("=================================");
    console.log("🤖 BOT BERJALAN SEPENUHNYA");
    console.log("=================================");
}

main();
    
