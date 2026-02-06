const tg = require('./helpers/telegram');

// delay
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// human typing
async function humanType(page, selector, text) {
    await page.waitForSelector(selector, { timeout: 30000 }); // 🔥 penting
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
        await sleep(5000);

        // 🔥 selector diperluas (biar nggak gagal)
        const emailSelector = `
            input[type='email'],
            input[name='email'],
            input[name='username'],
            input[type='text']
        `;
        const passSelector  = "input[type='password']";
        const btnSelector   = `
            button[type='submit'],
            input[type='submit'],
            button.login,
            button
        `;

        console.log("[BROWSER] Mencari input email...");
        await page.waitForSelector(emailSelector, { timeout: 30000 });

        // bersihkan email
        await page.click(emailSelector, { clickCount: 3 });
        await page.keyboard.press('Backspace');

        console.log("[BROWSER] Human typing email...");
        await humanType(page, emailSelector, email);

        console.log("[BROWSER] Mencari input password...");
        await page.waitForSelector(passSelector, { timeout: 30000 }); // 🔥 FIX BESAR

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
                "🟡 Sebelum klik login"
            ).catch(()=>{});
        }

        await sleep(700 + Math.random() * 1300);

        console.log("[BROWSER] Klik tombol login...");
        await page.click(btnSelector);

        await Promise.race([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(()=>{}),
            sleep(4000)
        ]);

        await sleep(3000);

        // screenshot setelah login
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
