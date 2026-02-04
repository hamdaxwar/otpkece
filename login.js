/**
 * Fungsi untuk menangani proses login dan navigasi paksa ke halaman GetNum
 * VERSI PUPPETEER-CORE (TERMUX FRIENDLY)
 * @param {import('puppeteer-core').Page} page 
 * @param {string} email 
 * @param {string} password 
 * @param {string} loginUrl 
 */
async function performLogin(page, email, password, loginUrl) {
    console.log("[BROWSER] Membuka halaman login...");
    // Puppeteer menggunakan 'networkidle2' sebagai padanan 'load/networkidle'
    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    console.log("[BROWSER] Menunggu stabilitas browser (2 detik)...");
    await new Promise(r => setTimeout(r, 2000));

    // Tunggu input muncul. Di Puppeteer tidak ada properti { state: 'visible' } di dalam waitForSelector
    // Kita gunakan waitForSelector standar.
    await page.waitForSelector("input[type='email']", { timeout: 30000 });
    
    console.log("[BROWSER] Mengisi email dan password...");
    
    // Puppeteer: Pastikan field kosong dulu sebelum mengetik
    await page.click("input[type='email']", { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type("input[type='email']", email, { delay: 50 }); 

    await page.click("input[type='password']", { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type("input[type='password']", password, { delay: 50 });
    
    console.log("[BROWSER] Menekan tombol Sign In...");
    // Puppeteer menggunakan selector standar untuk klik
    await page.click("button[type='submit']");

    console.log("[BROWSER] Menunggu proses login selesai (3 detik)...");
    await new Promise(r => setTimeout(r, 3000));

    // PAKSA REDIRECT LANGSUNG KE GETNUM
    console.log("[BROWSER] Melakukan navigasi paksa ke: https://stexsms.com/mdashboard/getnum");
    await page.goto("https://stexsms.com/mdashboard/getnum", { 
        waitUntil: 'networkidle2', 
        timeout: 60000 
    });

    // Verifikasi apakah sudah di halaman yang benar
    try {
        await page.waitForSelector("input[name='numberrange']", { timeout: 15000 });
        console.log("[BROWSER] KONFIRMASI: Berhasil berada di halaman GetNum.");
    } catch (e) {
        console.log("[BROWSER] Peringatan: Input range tidak ditemukan, mencoba refresh halaman...");
        await page.reload({ waitUntil: 'networkidle2' });
    }
}

module.exports = { performLogin };
