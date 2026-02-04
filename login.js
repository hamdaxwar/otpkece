const tg = require('./helpers/telegram');

/**
 * Fungsi untuk menangani proses login dan navigasi paksa ke halaman GetNum
 * VERSI PUPPETEER-CORE (TERMUX FRIENDLY)
 */
async function performLogin(page, email, password, loginUrl) {
    try {
        const adminId = process.env.ADMIN_ID;

        console.log("[BROWSER] Membuka halaman login...");
        await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log("[BROWSER] Menunggu stabilitas browser...");
        await new Promise(r => setTimeout(r, 2000));

        await page.waitForSelector("input[type='email']", { timeout: 30000 });
        
        console.log("[BROWSER] Mengisi email dan password...");
        
        // Membersihkan field sebelum mengisi
        await page.click("input[type='email']", { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.type("input[type='email']", email, { delay: 50 }); 

        await page.click("input[type='password']", { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.type("input[type='password']", password, { delay: 50 });
        
        console.log("[BROWSER] Menekan tombol Sign In...");
        await page.click("button[type='submit']");

        // Tunggu sebentar untuk proses login
        await new Promise(r => setTimeout(r, 4000));

        // --- DEBUG SCREENSHOT ---
        const ssPath = './debug_login.png';
        await page.screenshot({ path: ssPath });
        if (adminId) {
            await tg.tgSendPhoto(adminId, ssPath, `<b>DEBUG LOGIN</b>\nURL: <code>${page.url()}</code>`).catch(() => {});
        }

        // PAKSA REDIRECT LANGSUNG KE GETNUM
        console.log("[BROWSER] Navigasi paksa ke GetNum...");
        await page.goto("https://stexsms.com/mdashboard/getnum", { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // Verifikasi keberhasilan
        try {
            await page.waitForSelector("input[name='numberrange']", { timeout: 15000 });
            console.log("[BROWSER] KONFIRMASI: Berhasil di halaman GetNum.");
            return true;
        } catch (e) {
            console.log("[BROWSER] Gagal verifikasi halaman dashboard.");
            return false;
        }
    } catch (err) {
        console.error("[LOGIN ERROR]", err.message);
        return false;
    }
}

// EKSPOR DALAM BENTUK OBJEK (Penting agar tidak error "not a function")
module.exports = { performLogin };
