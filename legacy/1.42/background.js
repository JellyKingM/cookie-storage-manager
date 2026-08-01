const TAB_WINDOW_MAP_KEY = 'tabWindowMap';
const DATA_FOR_TAB_KEY_PREFIX = 'dataForTab:';
const creationLock = new Set();

// --- Storage Helpers ---
const getTabWindowMap = async () => (await chrome.storage.session.get(TAB_WINDOW_MAP_KEY))?.[TAB_WINDOW_MAP_KEY] || {};
const setTabWindowMap = async (map) => await chrome.storage.session.set({ [TAB_WINDOW_MAP_KEY]: map });

async function storeErrorForTab(tabId, errorCode, errorMessage) {
    const errorPopupData = {
        cookies: [],
        siteData: {
            localStorage: [],
            sessionStorage: [],
            indexedDB: [],
            cacheStorage: [],
            serviceWorkers: [],
            fileSystem: [],
            storageOverview: [],
            errors: [{ name: errorCode, value: errorMessage }],
            __error: errorMessage,
            __errorCode: errorCode
        }
    };
    await chrome.storage.session.set({ [`${DATA_FOR_TAB_KEY_PREFIX}${tabId}`]: errorPopupData });
}

// --- Data Fetching Helper ---
async function fetchDataForTab(tab) {
    try {
        const [cookies, siteDataResult] = await Promise.all([
            chrome.cookies.getAll({ url: tab.url }),
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: async () => {
                    const data = {
                        localStorage: [],
                        sessionStorage: [],
                        indexedDB: [],
                        cacheStorage: [],
                        serviceWorkers: [],
                        fileSystem: [],
                        storageOverview: [],
                        errors: []
                    };
                    const recordError = (area, error) => data.errors.push({ name: area, value: String(error) });

                    try {
                        for (let i = 0; i < localStorage.length; i++) {
                            const name = localStorage.key(i);
                            data.localStorage.push({ name, value: localStorage.getItem(name) });
                        }
                    } catch (error) { recordError('Local Storage', error); }

                    try {
                        for (let i = 0; i < sessionStorage.length; i++) {
                            const name = sessionStorage.key(i);
                            data.sessionStorage.push({ name, value: sessionStorage.getItem(name) });
                        }
                    } catch (error) { recordError('Session Storage', error); }

                    try {
                        if (typeof indexedDB.databases === 'function') {
                            const databases = await indexedDB.databases();
                            data.indexedDB = databases.filter(db => db.name).map(db => ({
                                name: db.name,
                                value: `Version ${db.version ?? '?'}`,
                                version: db.version
                            }));
                        } else {
                            recordError('IndexedDB', 'Database enumeration is not supported by this browser.');
                        }
                    } catch (error) { recordError('IndexedDB', error); }

                    try {
                        if ('caches' in globalThis) {
                            for (const name of await caches.keys()) {
                                const cache = await caches.open(name);
                                const requests = await cache.keys();
                                data.cacheStorage.push({
                                    name,
                                    value: `${requests.length} cached request(s)`,
                                    entries: requests.map(request => `${request.method} ${request.url}`)
                                });
                            }
                        }
                    } catch (error) { recordError('Cache Storage', error); }

                    try {
                        if ('serviceWorker' in navigator) {
                            const registrations = await navigator.serviceWorker.getRegistrations();
                            data.serviceWorkers = registrations.map(registration => ({
                                name: registration.scope,
                                value: registration.active?.state || registration.waiting?.state || registration.installing?.state || 'registered'
                            }));
                        }
                    } catch (error) { recordError('Service Workers', error); }

                    try {
                        if (navigator.storage?.getDirectory) {
                            const root = await navigator.storage.getDirectory();
                            for await (const [name, handle] of root.entries()) {
                                data.fileSystem.push({ name, value: handle.kind === 'directory' ? 'Directory' : 'File', kind: handle.kind });
                            }
                        }
                    } catch (error) { recordError('Origin Private File System', error); }

                    try {
                        const estimate = await navigator.storage?.estimate?.();
                        const persisted = await navigator.storage?.persisted?.();
                        if (estimate) {
                            data.storageOverview.push({ name: 'Usage', value: String(estimate.usage ?? 0) });
                            data.storageOverview.push({ name: 'Quota', value: String(estimate.quota ?? 0) });
                            data.storageOverview.push({ name: 'Persistent', value: persisted ? 'Yes' : 'No' });
                        }
                    } catch (error) { recordError('Storage Overview', error); }

                    return data;
                }
            })
        ]);

        const siteData = injectionResultToDataObject(siteDataResult);
        if (siteData.__error) {
            await storeErrorForTab(tab.id, siteData.__errorCode || 'INTERNAL_SCRIPT_ERROR', siteData.__error);
            return false;
        }

        const dataForPopup = {
            cookies: cookies || [],
            siteData
        };
        await chrome.storage.session.set({ [`${DATA_FOR_TAB_KEY_PREFIX}${tab.id}`]: dataForPopup });
        return true;
    } catch (e) {
        console.error(`Failed to fetch data for tab ${tab.id}:`, e);
        await storeErrorForTab(tab.id, 'SCRIPT_EXECUTION_FAILED', `Cannot access page content. The page may be protected by the browser (e.g., Chrome Web Store) or have a strict Content Security Policy.`);
        return false;
    }
}

function injectionResultToDataObject(results) {
    if (chrome.runtime.lastError || !results || results.length === 0 || !results[0].result) {
        return {};
    }
    return results[0].result;
}

// --- Display Helper ---
const getDisplayInfo = () => new Promise(resolve => {
    if (!chrome.system?.display) {
        console.warn("system.display permission not granted.");
        return resolve(null);
    }
    chrome.system.display.getInfo(displays => {
        if (chrome.runtime.lastError || !displays?.length) {
            console.warn("Could not get display info:", chrome.runtime.lastError?.message);
            return resolve(null);
        }
        resolve(displays);
    });
});

// --- Main Listeners ---
chrome.action.onClicked.addListener(async (tab) => {
    if (!tab?.id || !tab?.url) return;
    if (creationLock.has(tab.id)) return;

    creationLock.add(tab.id);

    try {
        // Handle existing popup window
        const tabWindowMap = await getTabWindowMap();
        const existingWindowId = tabWindowMap[tab.id];
        if (existingWindowId) {
            try {
                await chrome.windows.get(existingWindowId);
                await fetchDataForTab(tab); // Re-fetch data
                await chrome.windows.update(existingWindowId, { focused: true });
                return;
            } catch (e) {
                delete tabWindowMap[tab.id];
                await setTabWindowMap(tabWindowMap);
            }
        }

        // --- Pre-flight checks and data fetching ---
        if (!tab.url.startsWith('http')) {
            await storeErrorForTab(tab.id, 'UNSUPPORTED_SCHEME', 'This extension cannot run on special pages (e.g., chrome://, file://). ');
        } else if (tab.url.startsWith('https://chrome.google.com/webstore')) {
            await storeErrorForTab(tab.id, 'PROTECTED_PAGE', 'This extension cannot run on the Chrome Web Store for security reasons.');
        } else {
            // Host permissions are now required and granted at install time.
            // No need to request permissions dynamically.
            await fetchDataForTab(tab);
        }

        // --- Create Popup Window (always, to show data or error) ---
        const popupUrl = `popup.html?tabId=${tab.id}&title=${encodeURIComponent(tab.title ?? '')}&url=${encodeURIComponent(tab.url ?? '')}`;
        let createOptions = { url: popupUrl, type: 'popup', width: 800, height: 600 };
        const displays = await getDisplayInfo();

        if (displays) {
            const primaryDisplay = displays.find(d => d.isPrimary) || displays[0];
            createOptions.width = Math.round(primaryDisplay.workArea.width * 0.6);
            createOptions.height = Math.round(primaryDisplay.workArea.height * 0.5);
            createOptions.left = Math.round((primaryDisplay.workArea.width - createOptions.width) / 2);
            createOptions.top = Math.round((primaryDisplay.workArea.height - createOptions.height) / 2);
        }

        const newWindow = await chrome.windows.create(createOptions);
        if (newWindow?.id) {
            const map = await getTabWindowMap();
            map[tab.id] = newWindow.id;
            await setTabWindowMap(map);
        }

    } catch (e) {
        console.error("Error in onClicked listener:", e);
        try {
            await storeErrorForTab(tab.id, 'UNKNOWN_ERROR', 'An unexpected error occurred.');
        } catch (finalErr) {
            console.error("Failed to even store the final error:", finalErr);
        }
    } finally {
        creationLock.delete(tab.id);
    }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
    const tabWindowMap = await getTabWindowMap();
    const tabId = Object.keys(tabWindowMap).find(key => tabWindowMap[key] === windowId);
    if (tabId) {
        delete tabWindowMap[tabId];
        await setTabWindowMap(tabWindowMap);
        await chrome.storage.session.remove(`${DATA_FOR_TAB_KEY_PREFIX}${tabId}`);
    }
});
