const tg = require('./helpers/telegram');
const config = require('./config');
const fs = require('fs');

/**
 * Fungsi untuk menangani proses login dengan fitur Screenshot Otomatis ke Admin
 * @param {import('puppeteer-core').Page} page 
 * @param {string} email 
 * @param {string} password 
 * @param {string} loginUrl 
 */
async function performLogin(page, email, password, loginUrl) {
    try {
        const adminId = config.adminId || config.ownerId; // Ambil ID admin dari config

        console.log("[BROWSER] Membuka halaman login...");
        await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        await page.waitForSelector("input[type='email']", { timeout: 30000 });
        
        console.log("[BROWSER] Membersihkan dan mengisi data login...");
        await page.evaluate(() => {
            const emailInp = document.querySelector("input[type='email']");
            const passInp = document.querySelector("input[type='password']");
            if (emailInp) emailInp.value = '';
            if (passInp) passInp.value = '';
        });

        await page.type("input[type='email']", email, { delay: 100 }); 
        await page.type("input[type='password']", password, { delay: 100 });
        
        console.log("[BROWSER] Menekan tombol Sign In...");
        await page.click("button[type='submit']");

        // --- PROSES DEBUG SCREENSHOT ---
        console.log("[DEBUG] Menunggu 3 detik untuk menangkap hasil klik...");
        await new Promise(r => setTimeout(r, 3000)); 
        
        const screenshotPath = './login_status.png';
        await page.screenshot({ path: screenshotPath });

        if (adminId) {
            console.log("[SYSTEM] Mengirim screenshot status login ke Admin...");
            // Menggunakan helper telegram untuk kirim file
            // Jika tgSendPhoto tidak ada, kita pakai tgSendDocument (asumsi helper kamu punya ini)
            try {
                await tg.tgSendPhoto(adminId, screenshotPath, `📸 **Status Login Browser**\nURL: ${page.url()}`);
            } catch (err) {
                console.log("[ERROR] Gagal kirim foto, pastikan helper tgSendPhoto tersedia.");
            }
        }
        // -------------------------------

        // Cek apakah URL berubah (berhasil login)
        const finalUrl = page.url();
        if (finalUrl.includes('login')) {
            console.error("❌ [LOGIN GAGAL] Masih tertahan di halaman login.");
            return false;
        }

        console.log(`✅ [LOGIN BERHASIL] Redirected ke: ${finalUrl}`);

        // PAKSA KE HALAMAN TARGET (GETNUM)
        console.log("[BROWSER] Menuju halaman dashboard...");
        await page.goto("https://stexsms.com/mdashboard/getnum", { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // Verifikasi apakah elemen dashboard sudah muncul
        try {
            await page.waitForSelector("input[name='numberrange']", { timeout: 15000 });
            console.log("🚀 [SYSTEM] Dashboard siap digunakan.");
            return true;
        } catch (e) {
            console.log("⚠️ [WARNING] Input range belum muncul, mencoba reload...");
            await page.reload({ waitUntil: 'networkidle2' });
            return false;
        }

    } catch (error) {
        console.error("❌ [ERROR LOGIN.JS]:", error.message);
        return false;
    }
}

module.exports = { performLogin };
