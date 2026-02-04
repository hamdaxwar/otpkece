/**
 * Fungsi untuk menangani proses login dan navigasi paksa ke halaman GetNum
 * VERSI PUPPETEER-CORE (TERMUX FRIENDLY)
 * @param {import('puppeteer-core').Page} page 
 * @param {string} email 
 * @param {string} password 
 * @param {string} loginUrl 
 */
async function performLogin(page, email, password, loginUrl) {
    try {
        console.log("[BROWSER] Membuka halaman login...");
        await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Pastikan selector input sudah muncul
        await page.waitForSelector("input[type='email']", { timeout: 30000 });
        
        console.log("[BROWSER] Membersihkan dan mengisi data login...");
        
        // Gunakan evaluate agar pembersihan input lebih bersih dan cepat
        await page.evaluate(() => {
            const emailInp = document.querySelector("input[type='email']");
            const passInp = document.querySelector("input[type='password']");
            if (emailInp) emailInp.value = '';
            if (passInp) passInp.value = '';
        });

        // Ketik dengan delay kecil agar tidak terdeteksi bot sangat cepat
        await page.type("input[type='email']", email, { delay: 50 }); 
        await page.type("input[type='password']", password, { delay: 50 });
        
        console.log("[BROWSER] Menekan tombol Sign In...");
        
        // Eksekusi klik dan tunggu navigasi secara paralel
        await Promise.all([
            page.click("button[type='submit']"),
            // Kita tunggu sampai URL berubah (tidak lagi mengandung kata 'login')
            page.waitForFunction(
                (oldUrl) => !window.location.href.includes('login') && window.location.href !== oldUrl,
                { timeout: 30000 },
                loginUrl
            ).catch(() => console.log("[BROWSER] Menunggu perubahan URL secara manual..."))
        ]);

        // Jeda sangat singkat untuk sinkronisasi cookies
        await new Promise(r => setTimeout(r, 2000));

        const finalUrl = page.url();

        // LOGIKA PENGECEKAN URL
        if (finalUrl.includes('login')) {
            console.error("❌ [LOGIN GAGAL] URL masih di halaman login. Periksa Email/Pass atau Captcha.");
            
            // Opsional: Ambil SS jika gagal untuk debug
            await page.screenshot({ path: 'login_failed.png' });
            return false;
        } else {
            console.log(`✅ [LOGIN BERHASIL] Redirected ke: ${finalUrl}`);
        }

        // PAKSA KE HALAMAN TARGET (GETNUM)
        console.log("[BROWSER] Menuju halaman dashboard...");
        await page.goto("https://stexsms.com/mdashboard/getnum", { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // Verifikasi akhir apakah elemen dashboard muncul
        try {
            await page.waitForSelector("input[name='numberrange']", { timeout: 15000 });
            console.log("🚀 [SYSTEM] Dashboard siap digunakan.");
            return true;
        } catch (e) {
            console.log("⚠️ [WARNING] Dashboard termuat tapi input range belum muncul, mencoba reload...");
            await page.reload({ waitUntil: 'networkidle2' });
            return false;
        }

    } catch (error) {
        console.error("❌ [ERROR LOGIN.JS]:", error.message);
        return false;
    }
}

module.exports = { performLogin };
