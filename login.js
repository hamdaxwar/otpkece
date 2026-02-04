const tg = require('./helpers/telegram');

async function performLogin(page, email, password, loginUrl) {
    try {
        console.log("[BROWSER] Membuka halaman login...");
        
        await page.goto(loginUrl, { 
            waitUntil: 'load', // lebih stabil daripada networkidle2
            timeout: 60000 
        });

        await new Promise(r => setTimeout(r, 4000));

        console.log("[BROWSER] Debug: cari semua input di halaman...");

        // 🔎 LOG semua input yang ada di halaman
        const inputs = await page.$$eval("input", els =>
            els.map(e => ({
                type: e.type,
                name: e.name,
                id: e.id,
                class: e.className
            }))
        );

        console.log("[DEBUG INPUT]", inputs);

        // 🎯 selector email & password (fallback multi opsi)
        const emailSelector = "input[type='email'], input[name*='mail'], input[id*='mail'], input[name*='user'], input[id*='user']";
        const passSelector  = "input[type='password'], input[name*='pass'], input[id*='pass']";

        console.log("[BROWSER] Mencari input email...");
        await page.waitForSelector(emailSelector, { timeout: 20000 });

        console.log("[BROWSER] Mengisi email...");
        await page.click(emailSelector, { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.type(emailSelector, email, { delay: 50 });

        console.log("[BROWSER] Mengisi password...");
        await page.click(passSelector, { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.type(passSelector, password, { delay: 50 });

        console.log("[BROWSER] Menekan tombol Sign In...");
        await Promise.all([
            page.click("button[type='submit'], button:has-text('Sign'), input[type='submit']"),
            page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(()=>{})
        ]);

        await new Promise(r => setTimeout(r, 3000));

        const currentUrl = page.url();
        console.log("[DEBUG URL]", currentUrl);

        if (currentUrl.includes('login')) {
            console.log("[BROWSER] Login gagal (masih di halaman login).");

            // 📸 screenshot kalau gagal
            await page.screenshot({ path: 'login_failed.png' });
            if (process.env.ADMIN_ID) {
                await tg.tgSendPhoto(process.env.ADMIN_ID, 'login_failed.png', "❌ Login gagal / selector tidak cocok").catch(()=>{});
            }

            return false;
        }

        console.log("[BROWSER] Login berhasil.");
        return true;

    } catch (err) {
        console.error("[LOGIN ERROR]", err.message);

        // 📸 screenshot kalau error
        try {
            await page.screenshot({ path: 'login_error.png' });
            if (process.env.ADMIN_ID) {
                await tg.tgSendPhoto(process.env.ADMIN_ID, 'login_error.png', "❌ Error login: " + err.message).catch(()=>{});
            }
        } catch(e){}

        return false;
    }
}

module.exports = { performLogin };
