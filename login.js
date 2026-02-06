const tg = require('./helpers/telegram');

// delay
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// human typing
async function humanType(page, selector, text) {
    await page.waitForSelector(selector, { timeout: 30000 });
    await page.focus(selector);

    for (const char of text) {
        await page.keyboard.type(char);
        await sleep(60 + Math.random() * 120);
    }
}

async function performLogin(page, email, password, loginUrl) {
    try {
        console.log("[BROWSER] Membuka halaman login...");

        page.setDefaultTimeout(120000);
        page.setDefaultNavigationTimeout(120000);

        await page.goto(loginUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 120000
        });

        console.log("[BROWSER] Menunggu page stabil...");
        await sleep(4000);

        // selector fleksibel
        const emailSelector = `
            input[type='email'],
            input[name='email'],
            input[name='username'],
            input[type='text']
        `;
        const passSelector  = "input[type='password']";

        console.log("[BROWSER] Mencari input email...");
        await page.waitForSelector(emailSelector, { timeout: 30000 });

        // bersihkan email
        await page.click(emailSelector, { clickCount: 3 });
        await page.keyboard.press('Backspace');

        console.log("[BROWSER] Human typing email...");
        await humanType(page, emailSelector, email);

        await sleep(500);

        console.log("[BROWSER] Mencari input password...");
        await page.waitForSelector(passSelector, { timeout: 30000 });

        // bersihkan password
        await page.click(passSelector, { clickCount: 3 });
        await page.keyboard.press('Backspace');

        console.log("[BROWSER] Human typing password...");
        await humanType(page, passSelector, password);

        // screenshot sebelum login
        const imgBefore = "login_before.png";
        await page.screenshot({ path: imgBefore });

        if (process.env.ADMIN_ID) {
            await tg.tgSendPhoto(
                process.env.ADMIN_ID,
                imgBefore,
                "🟡 Sebelum tekan ENTER (login)"
            ).catch(()=>{});
        }

        await sleep(800 + Math.random() * 1200);

        // 🔥 LOGIN VIA ENTER (bukan klik tombol)
        console.log("[BROWSER] Tekan ENTER untuk login...");
        await page.keyboard.press("Enter");

        // tunggu redirect / perubahan halaman
        await Promise.race([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(()=>{}),
            sleep(5000)
        ]);

        await sleep(2000);

        // screenshot setelah login
        const imgAfter = "login_after.png";
        await page.screenshot({ path: imgAfter });

        if (process.env.ADMIN_ID) {
            await tg.tgSendPhoto(
                process.env.ADMIN_ID,
                imgAfter,
                "🟢 Setelah login (ENTER)"
            ).catch(()=>{});
        }

        const currentUrl = page.url();
        console.log("[DEBUG URL]", currentUrl);

        // deteksi login sukses
        if (
            currentUrl.includes("dashboard") ||
            currentUrl.includes("getnum") ||
            !currentUrl.includes("login")
        ) {
            console.log("[BROWSER] ✅ Login berhasil.");
            return true;
        }

        console.log("[BROWSER] ❌ Login gagal (masih di halaman login).");
        return false;

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
