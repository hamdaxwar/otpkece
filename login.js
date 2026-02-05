const tg = require('./helpers/telegram');

// fungsi delay random (human-like)
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// fungsi human typing
async function humanType(page, selector, text) {
    await page.focus(selector);

    for (const char of text) {
        await page.keyboard.type(char);
        await sleep(60 + Math.random() * 120); // delay lebih stabil
    }
}

async function performLogin(page, email, password, loginUrl) {
    try {
        console.log("[BROWSER] Membuka halaman login...");

        // 🔥 Timeout global (penting untuk Termux)
        page.setDefaultTimeout(120000);
        page.setDefaultNavigationTimeout(120000);

        await page.goto(loginUrl, { 
            waitUntil: 'domcontentloaded', // 🔥 jangan load (berat)
            timeout: 120000
        });

        // ⏳ tunggu page stabil
        console.log("[BROWSER] Menunggu page stabil...");
        await sleep(5000);

        const emailSelector = "input[type='email'], input[name='email']";
        const passSelector  = "input[type='password']";
        const btnSelector   = "button[type='submit'], input[type='submit']";

        console.log("[BROWSER] Mencari input email...");
        await page.waitForSelector(emailSelector, { timeout: 30000 });

        // 🧹 bersihkan email
        await page.click(emailSelector, { clickCount: 3 });
        await page.keyboard.press('Backspace');

        console.log("[BROWSER] Human typing email...");
        await humanType(page, emailSelector, email);

        // 🧹 bersihkan password
        await page.click(passSelector, { clickCount: 3 });
        await page.keyboard.press('Backspace');

        console.log("[BROWSER] Human typing password...");
        await humanType(page, passSelector, password);

        // 📸 screenshot sebelum login
        const imgBefore = "login_before.png";
        await page.screenshot({ path: imgBefore });

        if (process.env.ADMIN_ID) {
            await tg.tgSendPhoto(
                process.env.ADMIN_ID,
                imgBefore,
                "🟡 Sebelum klik login"
            ).catch(()=>{});
        }

        // 🕒 delay sebelum klik
        await sleep(700 + Math.random() * 1300);

        console.log("[BROWSER] Klik tombol login...");
        await page.click(btnSelector);

        // 🔥 jangan tunggu navigation terlalu lama
        await Promise.race([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(()=>{}),
            sleep(4000)
        ]);

        // ⏳ tunggu JS SPA settle
        await sleep(3000);

        // 📸 screenshot setelah login
        const imgAfter = "login_after.png";
        await page.screenshot({ path: imgAfter });

        if (process.env.ADMIN_ID) {
            await tg.tgSendPhoto(
                process.env.ADMIN_ID,
                imgAfter,
                "🟢 Setelah klik login"
            ).catch(()=>{});
        }

        const currentUrl = page.url();
        console.log("[DEBUG URL]", currentUrl);

        // 🔥 validasi login lebih fleksibel
        if (currentUrl.includes('login') || currentUrl.includes('signin')) {
            console.log("[BROWSER] Login gagal (masih di halaman login).");
            return false;
        }

        console.log("[BROWSER] Login berhasil.");
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
