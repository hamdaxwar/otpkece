const tg = require('./helpers/telegram');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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
        console.log("[BROWSER] Buka halaman login...");

        page.setDefaultTimeout(120000);
        page.setDefaultNavigationTimeout(120000);

        await page.goto(loginUrl, {
            waitUntil: 'networkidle2',
            timeout: 120000
        });

        await sleep(5000);

        const emailSelector = `
            input[type='email'],
            input[name='email'],
            input[name='username'],
            input[type='text']
        `;
        const passSelector = "input[type='password']";

        console.log("[BROWSER] Isi email...");
        await page.waitForSelector(emailSelector, { timeout: 30000 });
        await page.click(emailSelector, { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await humanType(page, emailSelector, email);

        console.log("[BROWSER] Isi password...");
        await page.waitForSelector(passSelector, { timeout: 30000 });
        await page.click(passSelector, { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await humanType(page, passSelector, password);

        // screenshot sebelum login
        const imgBefore = "login_before.png";
        await page.screenshot({ path: imgBefore });

        if (process.env.ADMIN_ID) {
            await tg.tgSendPhoto(process.env.ADMIN_ID, imgBefore, "🟡 Sebelum ENTER login")
                .catch(()=>{});
        }

        await sleep(800);

        console.log("[BROWSER] Tekan ENTER...");
        await page.keyboard.press('Enter');

        // 🔥 tunggu minimal 4 detik (karena StexSMS delay redirect)
        await sleep(4000);

        console.log("[BROWSER] Menunggu redirect ke dashboard/getnum...");

        let success = false;
        const start = Date.now();

        while (Date.now() - start < 30000) {
            const url = page.url();

            if (url.includes("/mdashboard/getnum") || url.includes("/dashboard")) {
                success = true;
                break;
            }

            await sleep(500);
        }

        await sleep(1500);

        // screenshot setelah redirect
        const imgAfter = "login_after.png";
        await page.screenshot({ path: imgAfter });

        if (process.env.ADMIN_ID) {
            await tg.tgSendPhoto(
                process.env.ADMIN_ID,
                imgAfter,
                success ? "✅ Login sukses + redirect getnum" : "❌ Login gagal / belum redirect"
            ).catch(()=>{});
        }

        console.log("[DEBUG URL]", page.url());

        if (!success) {
            console.log("[BROWSER] ❌ Login gagal.");
            return false;
        }

        console.log("[BROWSER] ✅ Login berhasil.");
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
        } catch {}

        return false;
    }
}

module.exports = { performLogin };
