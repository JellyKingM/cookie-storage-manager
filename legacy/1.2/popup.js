document.addEventListener('DOMContentLoaded', async () => {
    const languages = ['en', 'ko', 'zh_CN', 'ja', 'es', 'ru'];
    const messages = {};
    let currentLang = 'en';
    let activeTab;
    let currentData = null;

    const cookiesList = document.getElementById('cookies-list');
    const localStorageList = document.getElementById('localstorage-list');
    const searchBox = document.getElementById('search-box');

    // --- Utilities: clipboard & file download ---
    async function copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
    }

    function downloadText(filename, text) {
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    function nowStamp() {
      const d = new Date();
      const pad = (n)=> String(n).padStart(2, '0');
      return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }

    const safe = s => s.replace(/[\/:*?"<>|]/g, '_').slice(0, 80);

    function showToast(msg) {
      const el = document.getElementById('toast');
      if (!el) return;
      el.textContent = msg;
      el.classList.add('visible');
      setTimeout(() => el.classList.remove('visible'), 1800);
    }

    function withExportOverlay(fn) {
      const overlay = document.getElementById('export-overlay');
      if (!overlay) return fn();
      overlay.classList.add('visible');
      setTimeout(async () => {
        try { await fn(); } finally { overlay.classList.remove('visible'); }
      }, 30);
    }

    // --- 1. Localization & UI Helpers ---
    async function loadMessages() {
        for (const lang of languages) {
            try {
                const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
                const response = await fetch(url);
                if (response.ok) messages[lang] = await response.json();
            } catch (error) {
                console.error(`Error fetching messages for ${lang}:`, error);
            }
        }
    }

    const i18n = {
        getMessage: (key) => messages[currentLang]?.[key]?.message || messages['en']?.[key]?.message || `[${key}]`
    };

    function localizeHtmlPage(lang) {
        currentLang = lang;
        document.title = i18n.getMessage('extName');
        document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = i18n.getMessage(el.getAttribute('data-i18n')));
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => el.placeholder = i18n.getMessage(el.getAttribute('data-i18n-placeholder')));
        if (activeTab) {
            document.getElementById('fetch-time').textContent = `${i18n.getMessage('fetchedAt')} ${new Date().toLocaleTimeString()}`;
        }
    }

    function showBanner(message, type = 'info') {
        const banner = document.getElementById('notification-banner');
        if (!banner) return;
        banner.innerHTML = message;
        banner.className = `visible ${type}`;
        if (type === 'info') {
            setTimeout(() => {
                banner.classList.remove('visible');
            }, 5000); // Auto-dismiss info banners after 5 seconds
        }
    }

    // --- 2. Data Loading & Rendering ---
    async function loadDataFromStorage() {
        const tabId = parseInt(new URLSearchParams(window.location.search).get('tabId'));
        if (!tabId) {
            showBanner(i18n.getMessage('errorTabId'), 'error');
            return;
        }

        const storageKey = `dataForTab:${tabId}`;
        const result = await chrome.storage.session.get(storageKey);
        await chrome.storage.session.remove(storageKey);

        if (!result || !result[storageKey]) {
            showBanner(i18n.getMessage('errorAccess'), 'error');
            return;
        }

        const { cookies, localStorage } = result[storageKey];
        currentData = { cookies: cookies || [], localStorage: localStorage || {} };

        // Handle Global Errors
        if (localStorage?.__errorCode) {
            const errorCode = localStorage.__errorCode;
            const errorMessage = localStorage.__error;
            const messageKeyMap = {
                'UNSUPPORTED_SCHEME': 'errorUnsupportedScheme',
                'PERMISSION_DENIED': 'errorPermissionDenied',
                'SCRIPT_EXECUTION_FAILED': 'errorScriptExecutionFailed',
                'INTERNAL_SCRIPT_ERROR': 'errorInternalScript',
                'UNKNOWN_ERROR': 'errorUnknown'
            };
            const titleKey = messageKeyMap[errorCode] || 'errorUnknown';
            showBanner(`<strong>${i18n.getMessage(titleKey)}</strong><br>${errorMessage}`, 'error');
            cookiesList.innerHTML = `<div class="data-item">${i18n.getMessage('noCookies')}</div>`;
            localStorageList.innerHTML = `<div class="data-item">${i18n.getMessage('noLocalStorage')}</div>`;
            return;
        } 
        // Show info banner if there are HttpOnly cookies
        else if (cookies && cookies.some(c => c.httpOnly)) {
            showBanner(i18n.getMessage('tooltipHttpOnlyWarning'), 'info');
        }

        // Render Cookies
        cookiesList.innerHTML = '';
        if (!cookies || cookies.length === 0) {
            cookiesList.innerHTML = `<div class="data-item">${i18n.getMessage('noCookies')}</div>`;
        } else {
            renderList(cookiesList, cookies, (cookie) => createDataItem(cookie, 'cookie'));
        }

        // Render Local Storage
        localStorageList.innerHTML = '';
        const lsItems = Object.keys(localStorage).map(key => ({ name: key, value: localStorage[key] }));
        if (lsItems.length === 0) {
            localStorageList.innerHTML = `<div class="data-item">${i18n.getMessage('noLocalStorage')}</div>`;
        } else {
            renderList(localStorageList, lsItems, (item) => createDataItem(item, 'localStorage'));
        }
        
        addSectionButtons(cookies, localStorage);
        handleSearch();
    }

    const PAGE_SIZE = 200;
    function renderList(container, items, factory) {
        container.innerHTML = "";
        let page = 0;
        function draw() {
            const slice = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
            slice.forEach(obj => container.appendChild(factory(obj)));
            page++;
            if (page * PAGE_SIZE < items.length) {
                const btn = document.createElement('button');
                btn.className = 'load-more-btn';
                btn.textContent = `Load more (${items.length - page * PAGE_SIZE})`;
                btn.onclick = () => { btn.remove(); draw(); };
                container.appendChild(btn);
            }
        }
        draw();
    }

    // --- 3. UI & Event Handlers ---
    function initializePopup() {
        const params = new URLSearchParams(window.location.search);
        const tabId = parseInt(params.get('tabId'));
        const tabTitle = decodeURIComponent(params.get('title') || '');
        const tabUrl = decodeURIComponent(params.get('url') || '');

        if (!tabId || !tabUrl) {
            showBanner(i18n.getMessage('errorTabId'), 'error');
            return;
        }
        activeTab = { id: tabId, title: tabTitle, url: tabUrl };

        document.getElementById('tab-title').textContent = activeTab.title || activeTab.url;
        const tabUrlElement = document.getElementById('tab-url');
        tabUrlElement.textContent = new URL(activeTab.url).hostname;
        tabUrlElement.href = activeTab.url;
        document.getElementById('fetch-time').textContent = `${i18n.getMessage('fetchedAt')} ${new Date().toLocaleTimeString()}`;

        loadDataFromStorage();
    }

    function createDataItem(dataObject, type) {
        const item = document.createElement('div');
        item.className = 'data-item';
        item.dataset.key = dataObject.name;
        item.dataset.type = type;
        item.dataObject = dataObject;
        item.dataset.keyLc = dataObject.name.toLowerCase();
        item.dataset.valueLc = (dataObject.value || '').toLowerCase();

        const keyEl = document.createElement('div');
        keyEl.className = 'data-key';
        keyEl.textContent = dataObject.name;

        if (type === 'cookie') {
            const badgeContainer = document.createElement('span');
            badgeContainer.className = 'badge-container';
            if (dataObject.httpOnly) {
                const badge = document.createElement('span');
                badge.className = 'badge http-only';
                badge.textContent = 'HttpOnly';
                badgeContainer.appendChild(badge);
            }
            if (dataObject.secure) {
                const badge = document.createElement('span');
                badge.className = 'badge secure';
                badge.textContent = 'Secure';
                badgeContainer.appendChild(badge);
            }
            if (dataObject.partitionKey) {
                const badge = document.createElement('span');
                badge.className = 'badge partitioned';
                badge.textContent = 'Partitioned';
                badgeContainer.appendChild(badge);
            }
            keyEl.appendChild(badgeContainer);
            if (dataObject.httpOnly) {
                item.title = i18n.getMessage('tooltipHttpOnlyWarning');
            }
        }

        const valueEl = document.createElement('div');
        valueEl.className = 'data-value';
        valueEl.textContent = dataObject.value;

        setTimeout(() => {
            if (valueEl.scrollHeight > valueEl.clientHeight) {
                valueEl.classList.add('collapsible');
                const showMoreBtn = document.createElement('span');
                showMoreBtn.className = 'show-more-btn';
                showMoreBtn.textContent = i18n.getMessage('showMore');
                showMoreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isExpanded = valueEl.classList.toggle('expanded');
                    showMoreBtn.textContent = isExpanded ? i18n.getMessage('showLess') : i18n.getMessage('showMore');
                });
                valueEl.appendChild(showMoreBtn);
            }
        }, 0);

        const actionsEl = document.createElement('div');
        actionsEl.className = 'actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'action-btn';
        copyBtn.innerHTML = '⧉';
        copyBtn.title = i18n.getMessage('copyButtonLabel');
        copyBtn.setAttribute('aria-label', i18n.getMessage('copyButtonLabel'));

        const saveBtn = document.createElement('button');
        saveBtn.className = 'action-btn';
        saveBtn.innerHTML = '⬇';
        saveBtn.title = i18n.getMessage('saveButtonLabel');
        saveBtn.setAttribute('aria-label', i18n.getMessage('saveButtonLabel'));

        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const payload = (type === 'cookie') ? dataObject : { name: dataObject.name, value: dataObject.value };
            copyToClipboard(JSON.stringify(payload, null, 2));
            showToast(i18n.getMessage('copiedToast') || 'Copied to clipboard');
        });

        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const host = new URL(activeTab.url).hostname;
            const base = `${safe(host)}_${type}_${safe(dataObject.name)}_${nowStamp()}.json`;
            const payload = (type === 'cookie') ? dataObject : { name: dataObject.name, value: dataObject.value };
            downloadText(base, JSON.stringify(payload, null, 2));
            showToast(i18n.getMessage('savedToast') || 'Saved as file');
        });

        const editBtn = document.createElement('button');
        editBtn.className = 'action-btn';
        editBtn.innerHTML = '&#9998;';
        editBtn.title = i18n.getMessage('editButton');
        editBtn.setAttribute('aria-label', i18n.getMessage('editButton'));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'action-btn';
        deleteBtn.innerHTML = '&#10006;';
        deleteBtn.title = i18n.getMessage('deleteButton');
        deleteBtn.setAttribute('aria-label', i18n.getMessage('deleteButton'));

        if (type === 'cookie' && dataObject.httpOnly) {
            editBtn.disabled = true;
        } else {
            editBtn.addEventListener('click', () => toggleEditState(item, valueEl, editBtn));
        }
        deleteBtn.addEventListener('click', () => handleDelete(dataObject.name, type, item));

        actionsEl.appendChild(copyBtn);
        actionsEl.appendChild(saveBtn);
        actionsEl.appendChild(editBtn);
        actionsEl.appendChild(deleteBtn);

        item.appendChild(keyEl);
        item.appendChild(valueEl);
        item.appendChild(actionsEl);
        return item;
    }

    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    function handleSearch() {
        const searchTerm = searchBox.value.toLowerCase();
        let cookiesVisible = 0;
        let lsVisible = 0;

        document.querySelectorAll('#cookies-list .data-item').forEach(item => {
            if (item.classList.contains('error-item')) return;
            const isVisible = (item.dataset.keyLc || '').includes(searchTerm) || (item.dataset.valueLc || '').includes(searchTerm);
            item.classList.toggle('hidden', !isVisible);
            if (isVisible) cookiesVisible++;
        });

        document.querySelectorAll('#localstorage-list .data-item').forEach(item => {
            if (item.classList.contains('error-item')) return;
            const isVisible = (item.dataset.keyLc || '').includes(searchTerm) || (item.dataset.valueLc || '').includes(searchTerm);
            item.classList.toggle('hidden', !isVisible);
            if (isVisible) lsVisible++;
        });

        const cookiesHeader = document.querySelector('#cookies-section h2');
        if (cookiesHeader) {
            let countSpan = cookiesHeader.querySelector('.count');
            if (!countSpan) {
                countSpan = document.createElement('span');
                countSpan.className = 'count';
                cookiesHeader.appendChild(countSpan);
            }
            countSpan.textContent = ` (${cookiesVisible} found)`;
        }

        const lsHeader = document.querySelector('#localstorage-section h2');
        if (lsHeader) {
            let countSpan = lsHeader.querySelector('.count');
            if (!countSpan) {
                countSpan = document.createElement('span');
                countSpan.className = 'count';
                lsHeader.appendChild(countSpan);
            }
            countSpan.textContent = ` (${lsVisible} found)`;
        }
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
            const cookieToSet = {
                url: activeTab.url,
                name: key,
                value: newValue,
                domain: originalData.domain,
                path: originalData.path || "/",
                secure: !!originalData.secure,
                httpOnly: !!originalData.httpOnly,
                sameSite: originalData.sameSite || "no_restriction",
                expirationDate: originalData.session ? undefined : originalData.expirationDate,
                storeId: originalData.storeId
            };
            if (originalData.partitionKey) {
                cookieToSet.partitionKey = originalData.partitionKey;
            }
            chrome.cookies.set(cookieToSet, () => {
                if (chrome.runtime.lastError) alert(`Failed to set cookie: ${chrome.runtime.lastError.message}`);
                else originalData.value = newValue;
            });
        } else if (type === 'localStorage') {
            chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                func: (k, v) => localStorage.setItem(k, v),
                args: [key, newValue],
            }, () => {
                if (chrome.runtime.lastError) alert(`Failed to set localStorage item: ${chrome.runtime.lastError.message}`);
                else originalData.value = newValue;
            });
        }
    }

    function cookieRemovalUrl(cookie) {
        const scheme = cookie.secure ? 'https://' : 'http://';
        const host = (cookie.domain || new URL(activeTab.url).hostname).replace(/^\./, '');
        const path = cookie.path && cookie.path.startsWith('/') ? cookie.path : '/';
        return `${scheme}${host}${path}`;
    }

    function removeCookie(cookie) {
        return new Promise(resolve => {
            const cookieToRemove = {
                url: cookieRemovalUrl(cookie),
                name: cookie.name,
                storeId: cookie.storeId
            };
            if (cookie.partitionKey) cookieToRemove.partitionKey = cookie.partitionKey;
            chrome.cookies.remove(cookieToRemove, details => {
                resolve({ ok: !chrome.runtime.lastError && !!details, error: chrome.runtime.lastError?.message });
            });
        });
    }

    async function handleDelete(key, type, element) {
        if (type === 'cookie') {
            const originalData = element.dataObject;
            const result = await removeCookie(originalData);
            if (result.ok) {
                element.remove();
                currentData.cookies = currentData.cookies.filter(cookie => cookie !== originalData);
            } else {
                showBanner(`${i18n.getMessage('deleteFailed')}: ${result.error || key}`, 'error');
            }
        } else if (type === 'localStorage') {
            chrome.scripting.executeScript(
                { target: { tabId: activeTab.id }, func: (k) => localStorage.removeItem(k), args: [key] },
                () => {
                    if (!chrome.runtime.lastError) {
                        element.remove();
                        delete currentData.localStorage[key];
                    } else {
                        showBanner(`${i18n.getMessage('deleteFailed')}: ${chrome.runtime.lastError.message}`, 'error');
                    }
                }
            );
        }
    }

    // showError is deprecated. Use showBanner for consistent error display.
    // function showError(message) {
    //     document.body.innerHTML = `<div style="padding: 10px; text-align: center; color: #555;">${message}</div>`;
    // }

    function addSectionButtons(cookies, localStorageObj) {
      const host = activeTab ? new URL(activeTab.url).hostname : 'site';

      const cookiesHeader = document.querySelector('#cookies-section h2');
      const ckBtn = document.createElement('button');
      ckBtn.className = 'action-btn';
      ckBtn.textContent = i18n.getMessage('exportAllButtonLabel');
      ckBtn.title = i18n.getMessage('exportAllCookiesTitle');
      ckBtn.style.marginLeft = '8px';
      ckBtn.onclick = () => {
        const file = `${safe(host)}_cookies_${nowStamp()}.json`;
        downloadText(file, JSON.stringify(cookies ?? [], null, 2));
      };
      if (cookiesHeader) cookiesHeader.appendChild(ckBtn);

      const ckDeleteBtn = document.createElement('button');
      ckDeleteBtn.className = 'action-btn danger-btn';
      ckDeleteBtn.textContent = i18n.getMessage('deleteAllButtonLabel');
      ckDeleteBtn.title = i18n.getMessage('deleteAllCookiesTitle');
      ckDeleteBtn.disabled = !cookies?.length;
      ckDeleteBtn.onclick = async () => {
        if (!confirm(i18n.getMessage('confirmDeleteAllCookies'))) return;
        ckDeleteBtn.disabled = true;
        const results = await Promise.all(currentData.cookies.map(removeCookie));
        const failed = results.filter(result => !result.ok).length;
        if (failed) {
          showBanner(i18n.getMessage('deleteAllPartial').replace('$1', String(failed)), 'error');
          ckDeleteBtn.disabled = false;
        } else {
          currentData.cookies = [];
          cookiesList.innerHTML = `<div class="data-item">${i18n.getMessage('noCookies')}</div>`;
          showToast(i18n.getMessage('deleteAllComplete'));
          handleSearch();
        }
      };
      if (cookiesHeader) cookiesHeader.appendChild(ckDeleteBtn);

      const lsHeader = document.querySelector('#localstorage-section h2');
      const lsBtn = document.createElement('button');
      lsBtn.className = 'action-btn';
      lsBtn.textContent = i18n.getMessage('exportAllButtonLabel');
      lsBtn.title = i18n.getMessage('exportAllLSTitle');
      lsBtn.style.marginLeft = '8px';
      lsBtn.onclick = () => {
        const pairs = Object.keys(localStorageObj || {}).map(k => ({ name: k, value: localStorageObj[k] }));
        const file = `${safe(host)}_localStorage_${nowStamp()}.json`;
        downloadText(file, JSON.stringify(pairs, null, 2));
      };
      if (lsHeader) lsHeader.appendChild(lsBtn);

      const lsDeleteBtn = document.createElement('button');
      lsDeleteBtn.className = 'action-btn danger-btn';
      lsDeleteBtn.textContent = i18n.getMessage('deleteAllButtonLabel');
      lsDeleteBtn.title = i18n.getMessage('deleteAllLSTitle');
      lsDeleteBtn.disabled = Object.keys(localStorageObj || {}).length === 0;
      lsDeleteBtn.onclick = () => {
        if (!confirm(i18n.getMessage('confirmDeleteAllLS'))) return;
        lsDeleteBtn.disabled = true;
        chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: () => localStorage.clear()
        }, () => {
          if (chrome.runtime.lastError) {
            showBanner(`${i18n.getMessage('deleteFailed')}: ${chrome.runtime.lastError.message}`, 'error');
            lsDeleteBtn.disabled = false;
          } else {
            currentData.localStorage = {};
            localStorageList.innerHTML = `<div class="data-item">${i18n.getMessage('noLocalStorage')}</div>`;
            showToast(i18n.getMessage('deleteAllComplete'));
            handleSearch();
          }
        });
      };
      if (lsHeader) lsHeader.appendChild(lsDeleteBtn);
    }

    // --- 4. Initializer ---
    async function main() {
        await loadMessages();
        const languageSelector = document.getElementById('language-selector');
        languageSelector.addEventListener('change', (event) => {
            const selectedLang = event.target.value;
            chrome.storage.sync.set({ userLanguage: selectedLang }, async () => {
                // Ensure messages for the selected language are loaded
                await loadMessages(); // Re-load all messages
                localizeHtmlPage(selectedLang);
                if (currentData) {
                    const data = currentData;
                    cookiesList.innerHTML = data.cookies.length ? '' : `<div class="data-item">${i18n.getMessage('noCookies')}</div>`;
                    if (data.cookies.length) renderList(cookiesList, data.cookies, cookie => createDataItem(cookie, 'cookie'));
                    const lsItems = Object.keys(data.localStorage).map(key => ({ name: key, value: data.localStorage[key] }));
                    localStorageList.innerHTML = lsItems.length ? '' : `<div class="data-item">${i18n.getMessage('noLocalStorage')}</div>`;
                    if (lsItems.length) renderList(localStorageList, lsItems, item => createDataItem(item, 'localStorage'));
                    addSectionButtons(data.cookies, data.localStorage);
                    handleSearch();
                }
            });
        });

        const { userLanguage } = await chrome.storage.sync.get('userLanguage');
        const browserLang = chrome.i18n.getUILanguage().split('-')[0];
        const lang = userLanguage || (languages.includes(browserLang) ? browserLang : 'en');
        languageSelector.value = lang;
        localizeHtmlPage(lang);
        initializePopup();
    }

    // Setup resizer
    const resizer = document.getElementById('resizer');
    const cookiesSection = document.getElementById('cookies-section');
    const localStorageSection = document.getElementById('localstorage-section');
    const listWrapper = document.querySelector('.list-wrapper');
    let isResizing = false;
    resizer.addEventListener('mousedown', () => { isResizing = true; document.body.style.cursor = 'ns-resize'; listWrapper.style.userSelect = 'none'; });
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const totalHeight = listWrapper.getBoundingClientRect().height;
        const newCookiesHeight = (e.clientY - listWrapper.getBoundingClientRect().top) / totalHeight * 100;
        if (newCookiesHeight > 10 && newCookiesHeight < 90) {
            cookiesSection.style.flexBasis = `${newCookiesHeight}%`;
            localStorageSection.style.flexBasis = `${100 - newCookiesHeight}%`;
        }
    });
    document.addEventListener('mouseup', () => { isResizing = false; document.body.style.cursor = 'default'; listWrapper.style.userSelect = ''; });
    searchBox.addEventListener('input', debounce(handleSearch, 150));

    // --- Display Version ---
    const manifest = chrome.runtime.getManifest();
    const versionElement = document.getElementById('version-display');
    if (versionElement) {
        versionElement.textContent = `Version ${manifest.version}`;
    }

    main();
});
