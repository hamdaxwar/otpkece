const tg = require('./helpers/telegram');

async function performLogin(page, email, password, loginUrl) {
    try {
        console.log("[BROWSER] Membuka halaman login...");

        await page.goto(loginUrl, { 
            waitUntil: 'load', 
            timeout: 60000 
        });

        // 🕒 Delay agar halaman benar-benar stabil
        const delayMs = 4000;
        console.log(`[BROWSER] Menunggu stabilitas browser (${delayMs/1000} detik)...`);
        await page.waitForTimeout(delayMs);

        // 🔎 Selector fleksibel (lebih tahan perubahan UI)
        const emailSelector = "input[type='email'], input[name='email'], input[type='text']";
        const passSelector  = "input[type='password']";
        const btnSelector   = "button[type='submit'], input[type='submit']";

        console.log("[BROWSER] Menunggu input email...");
        await page.waitForSelector(emailSelector, { timeout: 20000 });

        console.log("[BROWSER] Mengisi email...");
        await page.click(emailSelector, { clickCount: 3 });
        await page.type(emailSelector, email, { delay: 50 });

        console.log("[BROWSER] Mengisi password...");
        await page.click(passSelector, { clickCount: 3 });
        await page.type(passSelector, password, { delay: 50 });

        // 📸 Screenshot sebelum klik login
        const imgBefore = "login_before.png";
        await page.screenshot({ path: imgBefore });

        if (process.env.ADMIN_ID) {
            await tg.tgSendPhoto(
                process.env.ADMIN_ID,
                imgBefore,
                "🟡 Sebelum klik login"
            ).catch(()=>{});
        }

        console.log("[BROWSER] Klik Sign In...");
        await Promise.all([
            page.click(btnSelector),
            page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(()=>{})
        ]);

        // 🕒 Delay setelah login
        await page.waitForTimeout(3000);

        const currentUrl = page.url();
        console.log("[DEBUG URL]", currentUrl);

        // ❌ Jika masih di halaman login
        if (currentUrl.includes('login')) {
            console.log("[BROWSER] Login gagal.");

            const imgFail = "login_failed.png";
            await page.screenshot({ path: imgFail });

            if (process.env.ADMIN_ID) {
                await tg.tgSendPhoto(
                    process.env.ADMIN_ID,
                    imgFail,
                    "❌ Login gagal (masih di halaman login)"
                ).catch(()=>{});
            }

            return false;
        }

        console.log("[BROWSER] Login berhasil.");

        // ✅ Screenshot setelah login sukses
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
