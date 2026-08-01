const TAB_WINDOW_MAP_KEY = 'tabWindowMap';
const DATA_FOR_TAB_KEY_PREFIX = 'dataForTab:';
const creationLock = new Set();

// --- Storage Helpers ---
const getTabWindowMap = async () => (await chrome.storage.session.get(TAB_WINDOW_MAP_KEY))?.[TAB_WINDOW_MAP_KEY] || {};
const setTabWindowMap = async (map) => await chrome.storage.session.set({ [TAB_WINDOW_MAP_KEY]: map });

async function storeErrorForTab(tabId, errorCode, errorMessage) {
    const errorPopupData = {
        cookies: [],
        localStorage: { __error: errorMessage, __errorCode: errorCode }
    };
    await chrome.storage.session.set({ [`${DATA_FOR_TAB_KEY_PREFIX}${tabId}`]: errorPopupData });
}

// --- Data Fetching Helper ---
async function fetchDataForTab(tab) {
    try {
        const [cookies, localStorageResult] = await Promise.all([
            chrome.cookies.getAll({ url: tab.url }),
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    try {
                        const data = {};
                        for (let i = 0; i < localStorage.length; i++) {
                            const k = localStorage.key(i);
                            data[k] = localStorage.getItem(k);
                        }
                        return data;
                    } catch (e) {
                        return { __error: String(e), __errorCode: 'INTERNAL_SCRIPT_ERROR' };
                    }
                }
            })
        ]);

        const lsData = injectionResultToDataObject(localStorageResult);
        if (lsData.__error) {
            await storeErrorForTab(tab.id, lsData.__errorCode || 'INTERNAL_SCRIPT_ERROR', lsData.__error);
            return false;
        }

        const dataForPopup = {
            cookies: cookies || [],
            localStorage: lsData
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
