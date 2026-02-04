const tg = require('./helpers/telegram');

async function performLogin(page, email, password, loginUrl) {
    try {
        console.log("[BROWSER] Membuka halaman login...");

        await page.goto(loginUrl, { 
            waitUntil: 'load', 
            timeout: 60000 
        });

        await new Promise(r => setTimeout(r, 3000));

        const emailSelector = "input[type='email']";
        const passSelector  = "input[type='password']";
        const btnSelector   = "button[type='submit']";

        console.log("[BROWSER] Menunggu input email...");
        await page.waitForSelector(emailSelector, { timeout: 20000 });

        console.log("[BROWSER] Mengisi email...");
        await page.fill(emailSelector, email);

        console.log("[BROWSER] Mengisi password...");
        await page.fill(passSelector, password);

        console.log("[BROWSER] Klik Sign In...");
        await Promise.all([
            page.click(btnSelector),
            page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(()=>{})
        ]);

        await new Promise(r => setTimeout(r, 3000));

        const currentUrl = page.url();
        console.log("[DEBUG URL]", currentUrl);

        if (currentUrl.includes('login')) {
            console.log("[BROWSER] Login gagal (masih di login).");
            return false;
        }

        console.log("[BROWSER] Login berhasil.");
        return true;

    } catch (err) {
        console.error("[LOGIN ERROR]", err.message);
        return false;
    }
}

module.exports = { performLogin };
