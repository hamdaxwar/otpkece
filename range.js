const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { state } = require('./helpers/state'); 

// ==================== KONFIGURASI ====================
const CONFIG = {
    BOT_TOKEN: "8264103317:AAG_-LZQIxrMDIlLlttWQqIvA9xu_GNMwnc",
    CHAT_ID: "-1003358198353",
    DASHBOARD_URL: "https://stexsms.com/mdashboard/console",
    ALLOWED_SERVICES: ['whatsapp', 'facebook'],
    BANNED_COUNTRIES: ['angola'],
    ATTACH_DELAY: 5000,
    SEND_DELAY: 1500 
};

let SENT_MESSAGES = new Map();
let CACHE_SET = new Set();
let MESSAGE_QUEUE = []; 
let IS_PROCESSING_QUEUE = false; 

const COUNTRY_EMOJI = require('./country.json');
const INLINE_JSON_PATH = path.join(__dirname, 'inline.json');

// ==================== UTILITY FUNCTIONS ====================

const getCountryEmoji = (countryName) => COUNTRY_EMOJI[countryName.toUpperCase()] || "🏴‍☠️";

const cleanPhoneNumber = (phone) => {
    if (!phone) return "N/A";
    return phone.replace(/[^0-9X]/g, '') || phone;
};

const cleanServiceName = (service) => {
    if (!service) return "Unknown";
    const sLower = service.toLowerCase();
    if (sLower.includes('facebook') || sLower.includes('laz+nxcar')) return 'Facebook';
    if (sLower.includes('whatsapp')) return 'WhatsApp';
    return service.trim();
};

async function processQueue() {
    if (IS_PROCESSING_QUEUE || MESSAGE_QUEUE.length === 0) return;
    IS_PROCESSING_QUEUE = true;

    while (MESSAGE_QUEUE.length > 0) {
        const item = MESSAGE_QUEUE.shift(); 
        try {
            if (SENT_MESSAGES.has(item.rangeVal)) {
                const oldMid = SENT_MESSAGES.get(item.rangeVal).message_id;
                await axios.post(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/deleteMessage`, {
                    chat_id: CONFIG.CHAT_ID, 
                    message_id: oldMid
                }).catch(() => {});
                await new Promise(r => setTimeout(r, 500));
            }

            const res = await axios.post(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendMessage`, {
                chat_id: CONFIG.CHAT_ID,
                text: item.text,
                parse_mode: 'HTML',
                reply_markup: { 
                    inline_keyboard: [[{ text: "📞GetNumber", url: "https://t.me/myzuraisgoodbot?start=ZuraBot" }]] 
                }
            });

            if (res.data.ok) {
                SENT_MESSAGES.set(item.rangeVal, {
                    message_id: res.data.result.message_id,
                    count: item.count,
                    timestamp: Date.now()
                });
                saveToInlineJson(item.rangeVal, item.country, item.service);
                console.log(`✅ [RANGE] Terkirim: ${item.rangeVal} (${item.count}x)`);
            }
        } catch (e) {
            if (e.response && e.response.status === 429) {
                const wait = (e.response.data.parameters?.retry_after || 10) * 1000;
                MESSAGE_QUEUE.unshift(item); 
                await new Promise(r => setTimeout(r, wait));
            } else {
                console.error(`❌ [RANGE] Send Error: ${e.message}`);
            }
        }
        await new Promise(r => setTimeout(r, CONFIG.SEND_DELAY));
    }
    IS_PROCESSING_QUEUE = false;
}

const saveToInlineJson = (rangeVal, countryName, service) => {
    const serviceMap = { 'whatsapp': 'WA', 'facebook': 'FB' };
    const serviceKey = service.toLowerCase();
    if (!serviceMap[serviceKey]) return;
    const shortService = serviceMap[serviceKey];

    try {
        let dataList = [];
        if (fs.existsSync(INLINE_JSON_PATH)) {
            try { dataList = JSON.parse(fs.readFileSync(INLINE_JSON_PATH, 'utf-8')); } catch (e) { dataList = []; }
        }
        if (dataList.some(item => item.range === rangeVal)) return;
        dataList.push({
            "range": rangeVal, "country": countryName.toUpperCase(),
            "emoji": getCountryEmoji(countryName), "service": shortService
        });
        if (dataList.length > 15) dataList = dataList.slice(-15);
        fs.writeFileSync(INLINE_JSON_PATH, JSON.stringify(dataList, null, 2), 'utf-8');
    } catch (e) {}
};

const formatLiveMessage = (rangeVal, count, countryName, service, fullMessage) => {
    const emoji = getCountryEmoji(countryName);
    const rangeWithCount = count > 1 ? `<code>${rangeVal}</code> (${count}x)` : `<code>${rangeVal}</code>`;
    const msgEscaped = fullMessage.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    
    return `🔥Live message new range\n\n` +
           `📱Range    : ${rangeWithCount}\n` +
           `${emoji}Country : ${countryName}\n` +
           `⚙️ Service : ${service}\n\n` +
           `🗯️Message Available :\n` +
           `<blockquote>${msgEscaped}</blockquote>`;
};

// ==================== MONITOR LOGIC ====================

async function startMonitor() {
    console.log("🚀 [RANGE] Menunggu browser aktif...");

    const checkState = setInterval(() => {
        if (state.browser) {
            clearInterval(checkState);
            setTimeout(() => { runMonitoringLoop(); }, CONFIG.ATTACH_DELAY);
        }
    }, 5000);

    async function runMonitoringLoop() {
        let monitorPage = null;
        while (true) {
            try {
                if (!monitorPage || monitorPage.isClosed()) {
                    // Di Puppeteer, kita langsung buat page baru dari browser state
                    monitorPage = await state.browser.newPage();
                    await monitorPage.setUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
                }

                if (!monitorPage.url().includes('/console')) {
                    await monitorPage.goto(CONFIG.DASHBOARD_URL, { waitUntil: 'networkidle2' }).catch(() => {});
                }

                const CONSOLE_SELECTOR = ".group.flex.flex-col.sm\\:flex-row.sm\\:items-start.gap-3.p-3.rounded-lg";
                await monitorPage.waitForSelector(CONSOLE_SELECTOR, { timeout: 5000 }).catch(() => {});

                // Ambil data menggunakan evaluate agar jauh lebih cepat di Termux
                const entries = await monitorPage.evaluate((sel) => {
                    const elements = document.querySelectorAll(sel);
                    return Array.from(elements).map(el => {
                        const rawC = el.querySelector(".flex-shrink-0 .text-\\[10px\\].text-slate-600.mt-1.font-mono")?.innerText || "";
                        const sRaw = el.querySelector(".flex-grow.min-w-0 .text-xs.font-bold.text-blue-400")?.innerText || "";
                        const phoneRaw = el.querySelector(".flex-grow.min-w-0 .text-\\[10px\\].font-mono:last-of-type")?.innerText || "";
                        const msgRaw = el.querySelector(".flex-grow.min-w-0 p")?.innerText || "";
                        
                        return { rawC, sRaw, phoneRaw, msgRaw };
                    });
                }, CONSOLE_SELECTOR);

                for (const entry of entries) {
                    try {
                        const country = entry.rawC.includes("•") ? entry.rawC.split("•")[1].trim() : "Unknown";
                        if (CONFIG.BANNED_COUNTRIES.includes(country.toLowerCase())) continue;

                        const service = cleanServiceName(entry.sRaw);
                        if (!CONFIG.ALLOWED_SERVICES.some(s => service.toLowerCase().includes(s))) continue;

                        const phone = cleanPhoneNumber(entry.phoneRaw);
                        const fullMessage = entry.msgRaw.replace('➜', '').trim();

                        const cacheKey = `${phone}_${fullMessage.length}`;

                        if (phone.includes('XXX') && !CACHE_SET.has(cacheKey)) {
                            CACHE_SET.add(cacheKey);
                            const currentData = SENT_MESSAGES.get(phone) || { count: 0 };
                            const newCount = currentData.count + 1;
                            
                            MESSAGE_QUEUE.push({
                                rangeVal: phone,
                                country,
                                service,
                                count: newCount,
                                text: formatLiveMessage(phone, newCount, country, service, fullMessage)
                            });
                            processQueue(); 
                        }
                    } catch (e) { continue; }
                }

                const now = Date.now();
                for (let [range, val] of SENT_MESSAGES.entries()) {
                    if (now - val.timestamp > 600000) SENT_MESSAGES.delete(range);
                }
            } catch (e) { console.error(`❌ [RANGE] Loop Error: ${e.message}`); }
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}

startMonitor();
