const fs = require('fs');
const tg = require('./helpers/telegram');

async function performLogin(page, loginUrl) {
    try {
        console.log("====================================");
        console.log("[SPY] MODE PENGINTAI LOGIN AKTIF");
        console.log("====================================");

        console.log("[SPY] Membuka halaman login...");
        await page.goto(loginUrl, { 
            waitUntil: 'load', 
            timeout: 60000 
        });

        // tunggu JS render
        await new Promise(r => setTimeout(r, 5000));

        // ===============================
        // 1️⃣ AMBIL HTML MENTAH HALAMAN
        // ===============================
        console.log("[SPY] Mengambil HTML halaman login...");
        const html = await page.content();
        fs.writeFileSync("login_raw.html", html);
        console.log("[SPY] HTML disimpan: login_raw.html");

        // ===============================
        // 2️⃣ AMBIL SEMUA INPUT
        // ===============================
        console.log("[SPY] Scan semua input...");
        const inputs = await page.$$eval("input", els =>
            els.map(e => ({
                tag: e.tagName,
                type: e.type,
                name: e.name,
                id: e.id,
                class: e.className,
                placeholder: e.placeholder,
                value: e.value
            }))
        );

        fs.writeFileSync("login_inputs.json", JSON.stringify(inputs, null, 2));
        console.log("[SPY] INPUT FOUND:", inputs);

        // ===============================
        // 3️⃣ AMBIL SEMUA FORM
        // ===============================
        console.log("[SPY] Scan semua form...");
        const forms = await page.$$eval("form", forms =>
            forms.map(f => ({
                action: f.action,
                method: f.method,
                innerHTML: f.innerHTML.slice(0, 500) // potong biar nggak terlalu panjang
            }))
        );

        fs.writeFileSync("login_forms.json", JSON.stringify(forms, null, 2));
        console.log("[SPY] FORMS FOUND:", forms);

        // ===============================
        // 4️⃣ CEK IFRAME
        // ===============================
        const frames = page.frames();
        console.log("[SPY] JUMLAH IFRAME:", frames.length);

        const iframeData = [];
        for (const frame of frames) {
            try {
                const frameHtml = await frame.content();
                iframeData.push({
                    url: frame.url(),
                    htmlSnippet: frameHtml.slice(0, 500)
                });
            } catch (e) {}
        }

        fs.writeFileSync("login_iframes.json", JSON.stringify(iframeData, null, 2));

        // ===============================
        // 5️⃣ SCREENSHOT HALAMAN LOGIN
        // ===============================
        await page.screenshot({ path: "login_page.png" });
        console.log("[SPY] Screenshot disimpan: login_page.png");

        // ===============================
        // 6️⃣ KIRIM KE TELEGRAM (OPSIONAL)
        // ===============================
        if (process.env.ADMIN_ID) {
            try {
                await tg.tgSendPhoto(process.env.ADMIN_ID, "login_page.png", "👁️ SPY LOGIN PAGE").catch(()=>{});
                await tg.tgSendMessage(
                    process.env.ADMIN_ID,
                    "🧠 INPUT LOGIN FOUND:\n" + JSON.stringify(inputs, null, 2)
                ).catch(()=>{});
            } catch(e){}
        }

        console.log("====================================");
        console.log("[SPY] SCAN LOGIN SELESAI ✅");
        console.log("====================================");

        return true;

    } catch (err) {
        console.error("[SPY ERROR]", err.message);
        return false;
    }
}

module.exports = { performLogin };
