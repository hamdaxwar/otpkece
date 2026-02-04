const tg = require('./helpers/telegram');
const config = require('./config');

/**
 * Fungsi login dengan Debug Screenshot
 */
async function performLogin(page, email, password, loginUrl) {
    try {
        const adminId = process.env.ADMIN_ID; // Ambil langsung dari env untuk debug

        console.log("[BROWSER] Membuka halaman login...");
        await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        await page.waitForSelector("input[type='email']", { timeout: 30000 });
        
        console.log("[BROWSER] Mengisi email dan password...");
        // Gunakan evaluate untuk memastikan field benar-benar bersih
        await page.evaluate(() => {
            document.querySelector("input[type='email']").value = '';
            document.querySelector("input[type='password']").value = '';
        });

        await page.type("input[type='email']", email, { delay: 50 }); 
        await page.type("input[type='password']", password, { delay: 50 });
        
        console.log("[BROWSER] Menekan tombol Sign In...");
        await page.click("button[type='submit']");

        // --- MULAI DEBUG ---
        console.log("[DEBUG] Menunggu 4 detik untuk melihat hasil klik...");
        await new Promise(r => setTimeout(r, 4000));

        const ssPath = './debug_login.png';
        await page.screenshot({ path: ssPath });

        if (adminId) {
            console.log("[DEBUG] Mengirim foto status ke Telegram...");
            await tg.tgSendPhoto(adminId, ssPath, `<b>DEBUG LOGIN</b>\nURL: <code>${page.url()}</code>\nEmail: <code>${email}</code>`);
        }
        // --- SELESAI DEBUG ---

        // Cek apakah masih di login (gagal)
        if (page.url().includes('login')) {
            console.log("❌ Login Gagal. Silakan cek screenshot di Telegram.");
            return false;
        }

        console.log("[BROWSER] Login sukses, menuju dashboard...");
        await page.goto("https://stexsms.com/mdashboard/getnum", { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        try {
            await page.waitForSelector("input[name='numberrange']", { timeout: 15000 });
            console.log("✅ Berhasil di Halaman GetNum.");
            return true;
        } catch (e) {
            console.log("⚠️ Range input tidak muncul, mencoba reload...");
            await page.reload({ waitUntil: 'networkidle2' });
            return false;
        }

    } catch (error) {
        console.error("❌ Error di login.js:", error.message);
        return false;
    }
}

module.exports = { performLogin };
