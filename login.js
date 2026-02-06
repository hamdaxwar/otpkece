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

        await sleep(5000);

        const emailSelector = `
            input[type='email'],
            input[name='email'],
            input[name='username'],
            input[type='text']
        `;
        const passSelector  = "input[type='password']";

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
            await tg.tgSendPhoto(process.env.ADMIN_ID, imgBefore, "🟡 Sebelum ENTER");
        }

        await sleep(800);

        console.log("[BROWSER] Tekan ENTER untuk login...");
        await page.keyboard.press("Enter");

        // tunggu 4 detik lalu redirect paksa
        await sleep(4000);

        console.log("[BROWSER] Redirect paksa ke dashboard...");
        await page.goto("https://stexsms.com/mdashboard/getnum", {
            waitUntil: "domcontentloaded",
            timeout: 120000
        });

        await sleep(4000);

        // screenshot setelah redirect
        const imgAfter = "login_after.png";
        await page.screenshot({ path: imgAfter });

        if (process.env.ADMIN_ID) {
            await tg.tgSendPhoto(process.env.ADMIN_ID, imgAfter, "🟢 Setelah redirect dashboard");
        }

        // ✅ CEK TOMBOL "Get Number"
        const isSuccess = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll("button"));
            return btns.some(btn => btn.innerText.includes("Get Number"));
        });

        if (isSuccess) {
            console.log("[LOGIN] ✅ BERHASIL (Get Number ditemukan)");
            return true;
        } else {
            console.log("[LOGIN] ❌ GAGAL (Get Number tidak ditemukan)");
            return false;
        }

    } catch (err) {
        console.error("[LOGIN ERROR]", err.message);

        try {
            const imgErr = "login_error.png";
            await page.screenshot({ path: imgErr });

            if (process.env.ADMIN_ID) {
                await tg.tgSendPhoto(process.env.ADMIN_ID, imgErr, "❌ Error login: " + err.message);
            }
        } catch(e){}

        return false;
    }
}

module.exports = { performLogin };
