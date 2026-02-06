const AsyncLock = require('async-lock');
const lock = new AsyncLock();

const state = {
    browser: null,
    sharedPage: null,
    pendingMessage: {},
    lastUsedRange: {},
    
    // Management Antrian (Locking)
    browserLock: {
        acquire: async function() {
            let releaseFunc;
            const promise = new Promise(resolve => {
                releaseFunc = resolve;
            });
            
            // Mengunci akses ke browser berdasarkan key 'puppeteer'
            await lock.acquire('puppeteer', () => promise);
            return releaseFunc;
        },
        isLocked: () => lock.isBusy('puppeteer')
    }
};

module.exports = state;
        
