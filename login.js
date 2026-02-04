const tg = require('./helpers/telegram');

async function performLogin(page, email, password, loginUrl) {
    try {
        console.log("[BROWSER] Membuka halaman login...");

        await page.goto(loginUrl, { 
            waitUntil: 'load', 
            timeout: 60000 
        });

        // 🕒 TUNGGU BROWSER TERMUAT SEMPURNA
        const delayMs = 4000; // ubah sesuai kebutuhan (ms)
        console.log(`[BROWSER] Menunggu stabilitas browser (${delayMs/1000} detik)...`);
        await new Promise(r => setTimeout(r, delayMs));

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

        // 🕒 Delay setelah login
        await new Promise(r => setTimeout(r, 3000));

        const currentUrl = page.url();
        console.log("[DEBUG URL]", currentUrl);

        // ❌ Jika masih di halaman login → gagal
        if (currentUrl.includes('login')) {
            console.log("[BROWSER] Login gagal (masih di halaman login).");

            const img = "login_failed.png";
            await page.screenshot({ path: img });

            if (process.env.ADMIN_ID) {
                await tg.tgSendPhoto(
                    process.env.ADMIN_ID,
                    img,
                    "❌ Login gagal (masih di halaman login)"
                ).catch(()=>{});
            }

            return false;
        }

        console.log("[BROWSER] Login berhasil.");

        // ✅ Screenshot setelah login berhasil (opsional)
        const imgOk = "login_success.png";
        await page.screenshot({ path: imgOk });

        if (process.env.ADMIN_ID) {
            await tg.tgSendPhoto(
                process.env.ADMIN_ID,
                imgOk,
                "✅ Login berhasil"
            ).catch(()=>{});
        }

        return true;

    } catch (err) {
        console.error("[LOGIN ERROR]", err.message);

        try {
            const imgErr = "login_error.png";
            await page.screenshot({ path: imgErr });

            if (process.env.ADMIN_ID) {
                await tg.tgSendPhoto(
                    process.env.ADMIN_ID,
                    imgErr,
                    "❌ Error login: " + err.message
                ).catch(()=>{});
            }
        } catch(e){}

        return false;
    }
}

module.exports = { performLogin };
