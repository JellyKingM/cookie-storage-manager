document.addEventListener('DOMContentLoaded', async () => {
    const languages = ['en', 'ko', 'zh', 'ja', 'es', 'ru'];
    const messages = {};
    let currentLang = 'en'; // Default language

    // --- 1. NEW: Language and Localization Setup ---

    // Load all message files into memory
    async function loadMessages() {
        for (const lang of languages) {
            try {
                const response = await fetch(`/_locales/${lang}/messages.json`);
                if (response.ok) {
                    messages[lang] = await response.json();
                } else {
                    console.warn(`Could not load messages for language: ${lang}`);
                }
            } catch (error) {
                console.error(`Error fetching messages for ${lang}:`, error);
            }
        }
    }

    // Custom function to get translated messages
    const i18n = {
        getMessage: (key) => {
            const langMessages = messages[currentLang];
            const defaultMessages = messages['en'];
            return langMessages?.[key]?.message || defaultMessages?.[key]?.message || `[${key}]`;
        }
    };

    // Overridden function to localize the entire page dynamically
    function localizeHtmlPage(lang) {
        currentLang = lang;

        // Set document title
        document.title = i18n.getMessage('extName');

        // Translate elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const messageKey = element.getAttribute('data-i18n');
            element.textContent = i18n.getMessage(messageKey);
        });

        // Translate placeholders with data-i18n-placeholder attribute
        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const messageKey = element.getAttribute('data-i18n-placeholder');
            element.placeholder = i18n.getMessage(messageKey);
        });

        // Re-render dynamic content that depends on language
        if (activeTab) {
            document.getElementById('fetch-time').textContent = `${i18n.getMessage('fetchedAt')} ${new Date().toLocaleTimeString()}`;
            // We might need to re-render lists if their "empty" or "error" messages are displayed
            if (cookiesList.querySelector('.data-item')?.dataset.key === undefined) {
                loadCookies();
            }
            if (localStorageList.querySelector('.data-item')?.dataset.key === undefined) {
                loadLocalStorage();
            }
        }
    }

    // --- 2. ORIGINAL LOGIC (MODIFIED) ---

    const cookiesList = document.getElementById('cookies-list');
    const localStorageList = document.getElementById('localstorage-list');
    const searchBox = document.getElementById('search-box');
    let activeTab;

    // Initialize: Get Tab Info
    const urlParams = new URLSearchParams(window.location.search);
    const tabId = parseInt(urlParams.get('tabId'));

    function initializePopup() {
        if (!tabId) {
            showError(i18n.getMessage('errorTabId'));
            return;
        }

        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError || !tab) {
                showError(i18n.getMessage('errorTabInfo'));
                return;
            }
            activeTab = tab;
            if (!activeTab.url || !activeTab.url.startsWith('http')) {
                showError(i18n.getMessage('errorAccess'));
                return;
            }

            // Display tab info
            document.getElementById('tab-title').textContent = activeTab.title || activeTab.url;
            const tabUrlElement = document.getElementById('tab-url');
            tabUrlElement.textContent = new URL(activeTab.url).hostname;
            tabUrlElement.href = activeTab.url;
            document.getElementById('fetch-time').textContent = `${i18n.getMessage('fetchedAt')} ${new Date().toLocaleTimeString()}`;

            loadCookies();
            loadLocalStorage();
        });
    }

    // Setup Event Listeners
    searchBox.addEventListener('input', handleSearch);

    // Resizer logic
    const resizer = document.getElementById('resizer');
    const cookiesSection = document.getElementById('cookies-section');
    const localStorageSection = document.getElementById('localstorage-section');
    const listWrapper = document.querySelector('.list-wrapper');
    let isResizing = false;
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'ns-resize';
        listWrapper.style.userSelect = 'none';
        listWrapper.style.pointerEvents = 'none';
    });
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const listWrapperRect = listWrapper.getBoundingClientRect();
        const totalHeight = listWrapperRect.height;
        const mouseY = e.clientY - listWrapperRect.top;
        let newCookiesHeight = (mouseY / totalHeight) * 100;
        let newLocalStorageHeight = 100 - newCookiesHeight;
        const minHeightPercent = 10;
        if (newCookiesHeight < minHeightPercent) {
            newCookiesHeight = minHeightPercent;
            newLocalStorageHeight = 100 - minHeightPercent;
        } else if (newLocalStorageHeight < minHeightPercent) {
            newLocalStorageHeight = minHeightPercent;
            newCookiesHeight = 100 - minHeightPercent;
        }
        cookiesSection.style.flexBasis = `${newCookiesHeight}%`;
        localStorageSection.style.flexBasis = `${newLocalStorageHeight}%`;
    });
    document.addEventListener('mouseup', () => {
        isResizing = false;
        document.body.style.cursor = 'default';
        listWrapper.style.userSelect = '';
        listWrapper.style.pointerEvents = '';
    });

    // Data Loading Functions
    function loadCookies() {
        const url = new URL(activeTab.url);
        chrome.cookies.getAll({ url: url.href }, (cookies) => {
            cookiesList.innerHTML = '';
            if (cookies.length === 0) {
                cookiesList.innerHTML = `<div class="data-item">${i18n.getMessage('noCookies')}</div>`;
                return;
            }
            cookies.forEach(cookie => {
                const item = createDataItem(cookie, 'cookie');
                cookiesList.appendChild(item);
            });
            handleSearch();
        });
    }

    function loadLocalStorage() {
        chrome.scripting.executeScript(
            { target: { tabId: activeTab.id }, func: () => JSON.parse(JSON.stringify(localStorage)) },
            (injectionResults) => {
                localStorageList.innerHTML = '';
                if (chrome.runtime.lastError || !injectionResults || injectionResults.length === 0) {
                    localStorageList.innerHTML = `<div class="data-item">${i18n.getMessage('errorLocalStorage')}</div>`;
                    return;
                }
                const data = injectionResults[0].result;
                if (Object.keys(data).length === 0) {
                    localStorageList.innerHTML = `<div class="data-item">${i18n.getMessage('noLocalStorage')}</div>`;
                    return;
                }
                for (const key in data) {
                    const item = createDataItem({ name: key, value: data[key] }, 'localStorage');
                    localStorageList.appendChild(item);
                }
                handleSearch();
            }
        );
    }

    // UI Element Creation
    function createDataItem(dataObject, type) {
        const item = document.createElement('div');
        item.className = 'data-item';
        item.dataset.key = dataObject.name;
        item.dataset.type = type;
        item.dataObject = dataObject;

        const keyEl = document.createElement('div');
        keyEl.className = 'data-key';
        keyEl.textContent = dataObject.name;

        const valueEl = document.createElement('div');
        valueEl.className = 'data-value';
        valueEl.textContent = dataObject.value;

        setTimeout(() => {
            if (valueEl.scrollHeight > valueEl.clientHeight) {
                valueEl.classList.add('collapsible');
                valueEl.addEventListener('click', () => valueEl.classList.toggle('expanded'));
            }
        }, 0);

        const actionsEl = document.createElement('div');
        actionsEl.className = 'actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'action-btn';
        editBtn.innerHTML = '&#9998;';
        editBtn.title = i18n.getMessage('editButton');
        editBtn.addEventListener('click', () => toggleEditState(item, valueEl, editBtn));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'action-btn';
        deleteBtn.innerHTML = '&#10006;';
        deleteBtn.title = i18n.getMessage('deleteButton');
        deleteBtn.addEventListener('click', () => handleDelete(dataObject.name, type, item));

        actionsEl.appendChild(editBtn);
        actionsEl.appendChild(deleteBtn);
        item.appendChild(keyEl);
        item.appendChild(valueEl);
        item.appendChild(actionsEl);

        return item;
    }

    // Event Handlers & Logic
    function handleSearch() {
        const searchTerm = searchBox.value.toLowerCase();
        document.querySelectorAll('.data-item').forEach(item => {
            if (!item.dataset.key) return;
            const key = item.dataset.key.toLowerCase();
            const value = item.querySelector('.data-value').textContent.toLowerCase();
            item.classList.toggle('hidden', !(key.includes(searchTerm) || value.includes(searchTerm)));
        });
    }

    function toggleEditState(item, valueEl, editBtn) {
        const isEditing = valueEl.isContentEditable;
        if (isEditing) {
            valueEl.contentEditable = false;
            editBtn.innerHTML = '&#9998;';
            editBtn.title = i18n.getMessage('editButton');
            valueEl.classList.remove('editing');
            saveChanges(item.dataset.key, valueEl.textContent, item.dataset.type, item.dataObject);
        } else {
            valueEl.contentEditable = true;
            editBtn.innerHTML = '&#128190;';
            editBtn.title = i18n.getMessage('saveButton');
            valueEl.classList.add('editing');
            valueEl.focus();
        }
    }

    function saveChanges(key, newValue, type, originalData) {
        if (type === 'cookie') {
            const url = new URL(activeTab.url);
            const newCookie = { ...originalData, url: url.href, name: key, value: newValue };
            delete newCookie.hostOnly;
            delete newCookie.session;
            chrome.cookies.set(newCookie, () => {
                if (!chrome.runtime.lastError) originalData.value = newValue;
            });
        } else if (type === 'localStorage') {
            chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                func: (k, v) => localStorage.setItem(k, v),
                args: [key, newValue],
            }, () => {
                if (!chrome.runtime.lastError) originalData.value = newValue;
            });
        }
    }

    function handleDelete(key, type, element) {
        const url = new URL(activeTab.url);
        if (type === 'cookie') {
            chrome.cookies.remove({ url: url.href, name: key }, () => {
                if (!chrome.runtime.lastError) element.remove();
            });
        } else if (type === 'localStorage') {
            chrome.scripting.executeScript(
                { target: { tabId: activeTab.id }, func: (k) => localStorage.removeItem(k), args: [key] },
                () => { if (!chrome.runtime.lastError) element.remove(); }
            );
        }
    }

    function showError(message) {
        document.body.innerHTML = `<div style="padding: 10px; text-align: center; color: #555;">${message}</div>`;
    }

    // --- 3. NEW: Initialization Logic ---
    async function main() {
        await loadMessages(); // Load translations first

        const languageSelector = document.getElementById('language-selector');

        languageSelector.addEventListener('change', (event) => {
            const selectedLang = event.target.value;
            chrome.storage.sync.set({ userLanguage: selectedLang }, () => {
                localizeHtmlPage(selectedLang);
            });
        });

        chrome.storage.sync.get('userLanguage', ({ userLanguage }) => {
            const browserLang = chrome.i18n.getUILanguage().split('-')[0]; // e.g., 'en-US' -> 'en'
            // Use stored language first, then browser language if supported, otherwise default to English.
            const lang = userLanguage || (languages.includes(browserLang) ? browserLang : 'en');
            languageSelector.value = lang;
            localizeHtmlPage(lang); // Localize page with the determined language
            initializePopup(); // Now run the original setup logic
        });
    }

    main(); // Run the main initialization function
});