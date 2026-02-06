const tg = require('./helpers/telegram');

// delay helper
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
            waitUntil: 'networkidle2',
            timeout: 120000
        });

        console.log("[BROWSER] Menunggu page stabil...");
        await sleep(5000);

        // selector fleksibel
        const emailSelector = `
            input[type='email'],
            input[name='email'],
            input[name='username'],
            input[type='text']
        `;
        const passSelector = "input[type='password']";

        console.log("[BROWSER] Cari input email...");
        await page.waitForSelector(emailSelector, { timeout: 30000 });

        // clear email
        await page.click(emailSelector, { clickCount: 3 });
        await page.keyboard.press('Backspace');

        console.log("[BROWSER] Ketik email...");
        await humanType(page, emailSelector, email);

        console.log("[BROWSER] Cari input password...");
        await page.waitForSelector(passSelector, { timeout: 30000 });

        // clear password
        await page.click(passSelector, { clickCount: 3 });
        await page.keyboard.press('Backspace');

        console.log("[BROWSER] Ketik password...");
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

        console.log("[BROWSER] Tekan ENTER untuk login...");
        await page.keyboard.press('Enter');

        // tunggu perubahan halaman
        await Promise.race([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(()=>{}),
            sleep(5000)
        ]);

        console.log("[BROWSER] Menunggu redirect dashboard/getnum...");

        // 🔥 tunggu redirect max 30 detik
        let success = false;
        const start = Date.now();

        while (Date.now() - start < 30000) {
            const url = page.url();

            if (
                url.includes("dashboard") ||
                url.includes("getnum")
            ) {
                success = true;
                break;
            }

            await sleep(500);
        }

        await sleep(2000);

        // screenshot setelah redirect
        const imgAfter = "login_after.png";
        await page.screenshot({ path: imgAfter });

        if (process.env.ADMIN_ID) {
            await tg.tgSendPhoto(
                process.env.ADMIN_ID,
                imgAfter,
                success
                    ? "✅ Login sukses + redirect OK"
                    : "⚠️ Login masuk tapi redirect belum terdeteksi"
            ).catch(()=>{});
        }

        const currentUrl = page.url();
        console.log("[DEBUG URL]", currentUrl);

        // 🔥 tambahan validasi element dashboard
        let dashboardDetected = false;
        try {
            dashboardDetected = await page.evaluate(() => {
                return document.body.innerText.includes("Welcome") ||
                       document.body.innerText.includes("Dashboard") ||
                       document.querySelector("a[href*='getnum']");
            });
        } catch {}

        if (!success && !dashboardDetected) {
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
        } catch(e){}

        return false;
    }
}

module.exports = { performLogin };
