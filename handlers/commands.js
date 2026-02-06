const config = require('../config');
const db = require('../helpers/database');
const tg = require('../helpers/telegram');
const state = require('../helpers/state'); 
const scraper = require('../helpers/scraper');
const adminHandler = require('./admin');

// Fungsi pembantu untuk memastikan objek user ada di state
function initUserState(userId) {
    if (!state.users) state.users = {};
    if (!state.users[userId]) {
        state.users[userId] = {
            waitingAdminInput: false,
            waitingBroadcastInput: false,
            get10RangeInput: false,
            waitingDanaInput: false,
            manualRangeInput: false,
            verified: false
        };
    }
    return state.users[userId];
}

async function processCommand(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const firstName = msg.from.first_name || "User";
    const usernameTg = msg.from.username;
    const mention = usernameTg ? `@${usernameTg}` : `<a href='tg://user?id=${userId}'>${firstName}</a>`;
    const text = msg.text || "";

    const userState = initUserState(userId);

    // ================== 1. HANDLER /START & PARAMETER ==================
    if (text.startsWith("/start")) {
        const args = text.split(" ");
        const startParam = args.length > 1 ? args[1] : null;

        // Jika ada parameter (Contoh: /start register)
        if (startParam) {
            console.log(`[START] User ${userId} masuk dengan parameter: ${startParam}`);
            // Kamu bisa tambahkan logika khusus di sini berdasarkan startParam
        }

        if (await tg.isUserInBothGroups(userId)) {
            userState.verified = true;
            db.saveUsers(userId);
            const prof = db.getUserProfile(userId, firstName);
            const fullName = usernameTg ? `${firstName} (@${usernameTg})` : firstName;
            
            const msgProfile = `✅ <b>Verifikasi Berhasil, ${mention}</b>\n\n` +
                `👤 <b>Profil Anda :</b>\n` +
                `🔖 <b>Nama</b> : ${fullName}\n` +
                `🧾 <b>Dana</b> : ${prof.dana}\n` +
                `👤 <b>A/N</b> : ${prof.dana_an}\n` +
                `📊 <b>Total OTP</b> : ${prof.otp_semua}\n` +
                `📊 <b>OTP Hari Ini</b> : ${prof.otp_hari_ini}\n` +
                `💰 <b>Balance</b> : $${prof.balance.toFixed(6)}\n`;

            const kb = {
                inline_keyboard: [
                    [{ text: "📲 Get Number", callback_data: "getnum" }, { text: "👨‍💼 Admin", url: "https://t.me/" + config.ADMIN_USERNAME }],
                    [{ text: "💸 Withdraw Money", callback_data: "withdraw_menu" }]
                ]
            };
            return await tg.tgSend(userId, msgProfile, kb);
        } else {
            const kb = {
                inline_keyboard: [
                    [{ text: "📌 Gabung Grup 1", url: config.GROUP_LINK_1 }],
                    [{ text: "📌 Gabung Grup 2", url: config.GROUP_LINK_2 }],
                    [{ text: "✅ Verifikasi Ulang", callback_data: "verify" }]
                ]
            };
            return await tg.tgSend(userId, `Halo ${mention} 👋\nHarap gabung kedua grup di bawah untuk verifikasi:`, kb);
        }
    }

    // ================== 2. HANDLER /STATUS & /CEK (DEBUG) ==================
    if (text === "/status") {
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const statusMsg = `📊 <b>BOT STATUS</b>\n` +
                          `⏱ Uptime: ${hours}j ${minutes}m\n` +
                          `🌐 Browser: ${state.sharedPage ? "✅ On" : "❌ Off"}\n` +
                          `⏳ Lock: ${state.browserLock.isLocked() ? "⚠️ Locked" : "✅ Free"}`;
        return await tg.tgSend(chatId, statusMsg);
    }

    if (text === "/cek") {
        return await scraper.sendDebugScreenshot(userId, "📸 Live View Browser");
    }

    // ================== 3. ADMIN COMMANDS ==================
    if (userId === parseInt(config.ADMIN_ID)) {
        if (text.startsWith("/add")) {
            userState.waitingAdminInput = true;
            const prompt = "Kirim daftar range:\n<code>range > country > service</code>";
            const mid = await tg.tgSend(userId, prompt);
            if (mid) state.pendingMessage[userId] = mid;
            return;
        } 
        else if (text === "/info") {
            userState.waitingBroadcastInput = true;
            const mid = await tg.tgSend(userId, "<b>Pesan Siaran</b>\n\nKirim pesan siaran atau ketik <code>.batal</code>");
            if (mid) {
                if (!state.broadcastMessage) state.broadcastMessage = {};
                state.broadcastMessage[userId] = mid;
            }
            return;
        } 
        else if (text.startsWith("/get10akses ")) {
            const targetId = text.split(" ")[1];
            db.saveAksesGet10(targetId);
            return await tg.tgSend(userId, `✅ Akses /get10 diberikan ke <code>${targetId}</code>`);
        } 
        else if (text === "/list") {
            return await adminHandler.handleListUsers(userId);
        }
    }

    // ================== 4. SPECIAL COMMANDS (/get10, /setdana) ==================
    if (text === "/get10") {
        if (db.hasGet10Access(userId)) {
            userState.get10RangeInput = true;
            const mid = await tg.tgSend(userId, "Kirim range (Contoh: 225071606XXX)");
            if (mid) state.pendingMessage[userId] = mid;
        } else {
            await tg.tgSend(userId, "❌ Akses Ditolak.");
        }
        return;
    }

    if (text.startsWith("/setdana")) {
        userState.waitingDanaInput = true;
        return await tg.tgSend(userId, "Kirim format:\n<code>Nomor Dana\nNama Pemilik</code>");
    }

    // ================== 5. STATE & INPUT HANDLERS ==================
    
    // Handler Input Admin (Add Range)
    if (userState.waitingAdminInput) {
        userState.waitingAdminInput = false;
        const pMsgId = state.pendingMessage[userId];
        delete state.pendingMessage[userId];
        return await adminHandler.handleAddRange(userId, text, pMsgId);
    }

    // Handler Broadcast
    if (userState.waitingBroadcastInput) {
        if (text.toLowerCase() === '.batal') {
            userState.waitingBroadcastInput = false;
            return await tg.tgSend(chatId, "❌ Broadcast dibatalkan.");
        }
        userState.waitingBroadcastInput = false;
        const pMsgId = state.broadcastMessage ? state.broadcastMessage[userId] : null;
        return await adminHandler.handleBroadcast(userId, chatId, text, pMsgId);
    }

    // Handler Set Dana
    if (userState.waitingDanaInput) {
        const lines = text.trim().split('\n');
        if (lines.length >= 2) {
            userState.waitingDanaInput = false;
            db.updateUserDana(userId, lines[0].trim(), lines.slice(1).join(' ').trim());
            return await tg.tgSend(userId, "✅ Data Dana disimpan.");
        }
        return await tg.tgSend(userId, "❌ Format salah. Ulangi /setdana");
    }

    // Handler Get10 Input
    if (userState.get10RangeInput) {
        userState.get10RangeInput = false;
        const prefix = text.trim();
        if (/^\+?\d{3,15}[Xx*#]+$/.test(prefix)) {
            let mid = await tg.tgSend(chatId, "⏳ Memulai Fetch 10...");
            return scraper.processUserInput(userId, prefix, 10, usernameTg, firstName, mid);
        }
        return await tg.tgSend(chatId, "❌ Format salah.");
    }

    // Handler Manual Range (Deteksi otomatis format XXX)
    const isManualFormat = /^\+?\d{3,15}[Xx*#]+$/.test(text.trim());
    if (isManualFormat && (userState.verified || userState.manualRangeInput)) {
        userState.manualRangeInput = false;
        const prefix = text.trim();
        let mid = await tg.tgSend(chatId, "⏳ Memulai Fetch 1...");
        return scraper.processUserInput(userId, prefix, 1, usernameTg, firstName, mid);
    }
}

module.exports = { processCommand };
