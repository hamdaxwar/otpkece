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
        await sleep(50 + Math.random() * 150); // delay random 50–200ms
    }
}

async function performLogin(page, email, password, loginUrl) {
    try {
        console.log("[BROWSER] Membuka halaman login...");

        await page.goto(loginUrl, { 
            waitUntil: 'load', 
            timeout: 60000 
        });

        // ⏳ Tunggu 10 detik setelah halaman load
        console.log("[BROWSER] Menunggu 10 detik sebelum mulai login...");
        await sleep(10000);

        // selector fleksibel
        const emailSelector = "input[type='email'], input[name='email']";
        const passSelector  = "input[type='password']";
        const btnSelector   = "button[type='submit'], input[type='submit']";

        console.log("[BROWSER] Mencari input email...");
        await page.waitForSelector(emailSelector, { timeout: 20000 });

        // 🧹 bersihkan field email
        await page.click(emailSelector, { clickCount: 3 });
        await page.keyboard.press('Backspace');

        console.log("[BROWSER] Human typing email...");
        await humanType(page, emailSelector, email);

        // 🧹 bersihkan field password
        await page.click(passSelector, { clickCount: 3 });
        await page.keyboard.press('Backspace');

        console.log("[BROWSER] Human typing password...");
        await humanType(page, passSelector, password);

        // 📸 screenshot sebelum klik login
        const imgBefore = "login_before.png";
        await page.screenshot({ path: imgBefore });

        if (process.env.ADMIN_ID) {
            await tg.tgSendPhoto(
                process.env.ADMIN_ID,
                imgBefore,
                "🟡 Sebelum klik login (human typing)"
            ).catch(()=>{});
        }

        // 🕒 delay kecil sebelum klik tombol
        await sleep(800 + Math.random() * 1200);

        console.log("[BROWSER] Klik tombol Sign In...");
        await page.click(btnSelector);

        // tunggu kemungkinan redirect / SPA
        await Promise.race([
            page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(()=>{}),
            sleep(5000)
        ]);

        // 📸 screenshot setelah klik login
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

        if (currentUrl.includes('login')) {
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
