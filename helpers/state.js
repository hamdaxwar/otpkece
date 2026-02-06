const AsyncLock = require('async-lock');
const lock = new AsyncLock();

const state = {
    browser: null,
    sharedPage: null,
    pendingMessage: {},
    lastUsedRange: {},
    users: {}, // TAMBAHKAN INI: Untuk fix error waitingAdminInput
    
    // Management Antrian (Locking)
    browserLock: {
        acquire: async function() {
            let releaseFunc;
            const promise = new Promise(resolve => {
                releaseFunc = resolve;
            });
            await lock.acquire('puppeteer', () => promise);
            return releaseFunc;
        },
        isLocked: () => lock.isBusy('puppeteer')
    }
};

module.exports = state;
