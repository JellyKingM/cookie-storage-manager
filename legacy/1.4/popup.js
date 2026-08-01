document.addEventListener('DOMContentLoaded', async () => {
    const languages = ['en', 'ko', 'zh_CN', 'ja', 'es', 'ru'];
    const messages = {};
    let currentLang = 'en';
    let activeTab;
    let currentData;
    let activeSection = 'cookies';

    const tabsElement = document.getElementById('storage-tabs');
    const listElement = document.getElementById('active-data-list');
    const titleElement = document.getElementById('active-section-title');
    const actionsElement = document.getElementById('section-actions');
    const searchBox = document.getElementById('search-box');

    const sectionDefinitions = [
        { id: 'cookies', label: 'cookiesTitle', empty: 'noCookies', mutable: true },
        { id: 'localStorage', label: 'localStorageTitle', empty: 'noLocalStorage', mutable: true },
        { id: 'sessionStorage', label: 'sessionStorageTitle', empty: 'noSessionStorage', mutable: true },
        { id: 'indexedDB', label: 'indexedDBTitle', empty: 'noIndexedDB', mutable: true },
        { id: 'cacheStorage', label: 'cacheStorageTitle', empty: 'noCacheStorage', mutable: true },
        { id: 'serviceWorkers', label: 'serviceWorkersTitle', empty: 'noServiceWorkers', mutable: true },
        { id: 'fileSystem', label: 'fileSystemTitle', empty: 'noFileSystem', mutable: true },
        { id: 'storageOverview', label: 'storageOverviewTitle', empty: 'noStorageOverview', mutable: false },
        { id: 'errors', label: 'errorsTitle', empty: 'noErrors', mutable: false }
    ];

    async function loadMessages() {
        for (const lang of languages) {
            try {
                const response = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
                if (response.ok) messages[lang] = await response.json();
            } catch (error) {
                console.error(`Could not load ${lang} messages:`, error);
            }
        }
    }

    const i18n = {
        getMessage(key) {
            return messages[currentLang]?.[key]?.message || messages.en?.[key]?.message || `[${key}]`;
        }
    };

    function localizeHtmlPage(lang) {
        currentLang = lang;
        document.title = i18n.getMessage('extName');
        document.querySelectorAll('[data-i18n]').forEach(element => {
            element.textContent = i18n.getMessage(element.dataset.i18n);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            element.placeholder = i18n.getMessage(element.dataset.i18nPlaceholder);
        });
        if (activeTab) {
            document.getElementById('fetch-time').textContent = `${i18n.getMessage('fetchedAt')} ${new Date().toLocaleTimeString()}`;
        }
        if (currentData) renderWorkspace();
    }

    function showBanner(message, type = 'info') {
        const banner = document.getElementById('notification-banner');
        banner.textContent = message;
        banner.className = `visible ${type}`;
        if (type === 'info') setTimeout(() => banner.classList.remove('visible'), 5000);
    }

    function showToast(message) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.add('visible');
        setTimeout(() => toast.classList.remove('visible'), 2200);
    }

    function safeFilePart(value) {
        return String(value).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    }

    function nowStamp() {
        const date = new Date();
        const pad = number => String(number).padStart(2, '0');
        return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    }

    function downloadJson(filename, value) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const area = document.createElement('textarea');
            area.value = text;
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            area.remove();
        }
    }

    function executeOnPage(func, args = []) {
        return new Promise((resolve, reject) => {
            chrome.scripting.executeScript({ target: { tabId: activeTab.id }, func, args }, results => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(results?.[0]?.result);
            });
        });
    }

    async function loadData() {
        const storageKey = `dataForTab:${activeTab.id}`;
        const stored = await chrome.storage.session.get(storageKey);
        await chrome.storage.session.remove(storageKey);
        if (!stored?.[storageKey]) {
            showBanner(i18n.getMessage('errorAccess'), 'error');
            return;
        }

        const payload = stored[storageKey];
        const siteData = payload.siteData || {};
        currentData = {
            cookies: payload.cookies || [],
            localStorage: siteData.localStorage || [],
            sessionStorage: siteData.sessionStorage || [],
            indexedDB: siteData.indexedDB || [],
            cacheStorage: siteData.cacheStorage || [],
            serviceWorkers: siteData.serviceWorkers || [],
            fileSystem: siteData.fileSystem || [],
            storageOverview: siteData.storageOverview || [],
            errors: siteData.errors || []
        };

        if (siteData.__errorCode) showBanner(siteData.__error || i18n.getMessage('errorAccess'), 'error');
        else if (currentData.cookies.some(cookie => cookie.httpOnly)) showBanner(i18n.getMessage('tooltipHttpOnlyWarning'), 'info');
        renderWorkspace();
    }

    function getSection() {
        return sectionDefinitions.find(section => section.id === activeSection);
    }

    function renderWorkspace() {
        renderTabs();
        renderActiveSection();
    }

    function renderTabs() {
        tabsElement.innerHTML = '';
        for (const section of sectionDefinitions) {
            const button = document.createElement('button');
            button.className = 'storage-tab';
            button.type = 'button';
            button.role = 'tab';
            button.dataset.section = section.id;
            button.setAttribute('aria-selected', String(section.id === activeSection));
            if (section.id === activeSection) button.classList.add('active');
            const count = currentData[section.id]?.length || 0;
            button.innerHTML = `<span>${i18n.getMessage(section.label)}</span><span class="tab-count">${count}</span>`;
            button.addEventListener('click', () => {
                activeSection = section.id;
                renderWorkspace();
            });
            tabsElement.appendChild(button);
        }
    }

    function formatValue(item, sectionId) {
        if (sectionId === 'storageOverview' && ['Usage', 'Quota'].includes(item.name)) {
            const bytes = Number(item.value);
            if (Number.isFinite(bytes)) return `${bytes.toLocaleString()} bytes (${(bytes / 1024 / 1024).toFixed(2)} MiB)`;
        }
        if (item.entries?.length) return `${item.value}\n${item.entries.join('\n')}`;
        return String(item.value ?? '');
    }

    function renderActiveSection() {
        const section = getSection();
        const items = currentData[activeSection] || [];
        titleElement.textContent = `${i18n.getMessage(section.label)} (${items.length})`;
        actionsElement.innerHTML = '';
        listElement.innerHTML = '';

        addSectionAction(i18n.getMessage('exportAllButtonLabel'), 'export', () => {
            const host = new URL(activeTab.url).hostname;
            downloadJson(`${safeFilePart(host)}_${activeSection}_${nowStamp()}.json`, items);
        }, items.length === 0);

        if (section.mutable) {
            addSectionAction(i18n.getMessage('deleteAllButtonLabel'), 'danger', () => clearSection(activeSection), items.length === 0);
        }

        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = i18n.getMessage(section.empty);
            listElement.appendChild(empty);
            return;
        }

        for (const item of items) listElement.appendChild(createDataItem(item, section));
        applySearch();
    }

    function addSectionAction(label, style, handler, disabled) {
        const button = document.createElement('button');
        button.className = `section-action ${style}`;
        button.textContent = label;
        button.disabled = disabled;
        button.addEventListener('click', handler);
        actionsElement.appendChild(button);
    }

    function createDataItem(item, section) {
        const row = document.createElement('div');
        row.className = 'data-item';
        row.dataset.search = `${item.name || ''} ${formatValue(item, section.id)}`.toLowerCase();

        const key = document.createElement('div');
        key.className = 'data-key';
        key.textContent = item.name;
        if (section.id === 'cookies') {
            const badges = document.createElement('span');
            badges.className = 'badge-container';
            for (const [enabled, text, className] of [
                [item.httpOnly, 'HttpOnly', 'http-only'],
                [item.secure, 'Secure', 'secure'],
                [item.partitionKey, 'Partitioned', 'partitioned']
            ]) {
                if (enabled) {
                    const badge = document.createElement('span');
                    badge.className = `badge ${className}`;
                    badge.textContent = text;
                    badges.appendChild(badge);
                }
            }
            key.appendChild(badges);
        }

        const value = document.createElement('div');
        value.className = 'data-value';
        value.textContent = formatValue(item, section.id);

        const rowActions = document.createElement('div');
        rowActions.className = 'actions';
        addRowButton(rowActions, '⧉', i18n.getMessage('copyButtonLabel'), async () => {
            await copyText(JSON.stringify(item, null, 2));
            showToast(i18n.getMessage('copiedToast'));
        });

        if (['cookies', 'localStorage', 'sessionStorage'].includes(section.id)) {
            const edit = addRowButton(rowActions, '✎', i18n.getMessage('editButton'), () => toggleEdit(row, value, edit, item, section.id));
            if (section.id === 'cookies' && item.httpOnly) edit.disabled = true;
        }
        if (section.mutable) addRowButton(rowActions, '✕', i18n.getMessage('deleteButton'), () => deleteItem(item, section.id));

        row.append(key, value, rowActions);
        return row;
    }

    function addRowButton(container, text, title, handler) {
        const button = document.createElement('button');
        button.className = 'action-btn';
        button.textContent = text;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.addEventListener('click', handler);
        container.appendChild(button);
        return button;
    }

    async function toggleEdit(row, valueElement, button, item, sectionId) {
        if (!valueElement.isContentEditable) {
            valueElement.contentEditable = 'true';
            valueElement.classList.add('editing');
            button.textContent = '💾';
            valueElement.focus();
            return;
        }
        try {
            const newValue = valueElement.textContent;
            if (sectionId === 'cookies') await setCookie(item, newValue);
            else {
                await executeOnPage((storageType, name, value) => window[storageType].setItem(name, value), [sectionId, item.name, newValue]);
            }
            item.value = newValue;
            valueElement.contentEditable = 'false';
            valueElement.classList.remove('editing');
            button.textContent = '✎';
            showToast(i18n.getMessage('savedToast'));
        } catch (error) {
            showBanner(`${i18n.getMessage('saveFailed')}: ${error.message}`, 'error');
        }
    }

    function setCookie(cookie, newValue) {
        return new Promise((resolve, reject) => {
            const details = {
                url: cookieRemovalUrl(cookie), name: cookie.name, value: newValue,
                domain: cookie.domain, path: cookie.path || '/', secure: !!cookie.secure,
                httpOnly: !!cookie.httpOnly, sameSite: cookie.sameSite || 'unspecified',
                storeId: cookie.storeId
            };
            if (!cookie.session) details.expirationDate = cookie.expirationDate;
            if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
            chrome.cookies.set(details, result => {
                if (chrome.runtime.lastError || !result) reject(new Error(chrome.runtime.lastError?.message || 'Cookie was not saved.'));
                else resolve(result);
            });
        });
    }

    function cookieRemovalUrl(cookie) {
        const scheme = cookie.secure ? 'https://' : 'http://';
        const host = (cookie.domain || new URL(activeTab.url).hostname).replace(/^\./, '');
        const path = cookie.path?.startsWith('/') ? cookie.path : '/';
        return `${scheme}${host}${path}`;
    }

    function removeCookie(cookie) {
        return new Promise(resolve => {
            const details = { url: cookieRemovalUrl(cookie), name: cookie.name, storeId: cookie.storeId };
            if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
            chrome.cookies.remove(details, removed => resolve(!chrome.runtime.lastError && !!removed));
        });
    }

    async function deleteItem(item, sectionId) {
        try {
            let deleted = false;
            if (sectionId === 'cookies') deleted = await removeCookie(item);
            else if (sectionId === 'localStorage' || sectionId === 'sessionStorage') {
                deleted = await executeOnPage((storageType, name) => { window[storageType].removeItem(name); return true; }, [sectionId, item.name]);
            } else if (sectionId === 'indexedDB') {
                deleted = await executeOnPage(name => new Promise(resolve => {
                    const request = indexedDB.deleteDatabase(name);
                    request.onsuccess = () => resolve(true);
                    request.onerror = () => resolve(false);
                    request.onblocked = () => resolve(false);
                }), [item.name]);
            } else if (sectionId === 'cacheStorage') deleted = await executeOnPage(name => caches.delete(name), [item.name]);
            else if (sectionId === 'serviceWorkers') deleted = await executeOnPage(async scope => {
                const registrations = await navigator.serviceWorker.getRegistrations();
                const registration = registrations.find(candidate => candidate.scope === scope);
                return registration ? registration.unregister() : true;
            }, [item.name]);
            else if (sectionId === 'fileSystem') deleted = await executeOnPage(async name => {
                const root = await navigator.storage.getDirectory();
                await root.removeEntry(name, { recursive: true });
                return true;
            }, [item.name]);

            if (!deleted) throw new Error(i18n.getMessage('deleteFailed'));
            currentData[sectionId] = currentData[sectionId].filter(candidate => candidate !== item);
            renderWorkspace();
        } catch (error) {
            showBanner(`${i18n.getMessage('deleteFailed')}: ${error.message}`, 'error');
        }
    }

    async function clearSection(sectionId) {
        const section = sectionDefinitions.find(candidate => candidate.id === sectionId);
        if (!confirm(i18n.getMessage('confirmDeleteSection').replace('$1', i18n.getMessage(section.label)))) return;
        const items = [...currentData[sectionId]];
        let failed = 0;
        for (const item of items) {
            try {
                const before = currentData[sectionId].length;
                await deleteItem(item, sectionId);
                if (currentData[sectionId].length === before) failed++;
            } catch { failed++; }
        }
        if (!failed) showToast(i18n.getMessage('deleteAllComplete'));
    }

    function clearBrowsingData(origin) {
        return new Promise((resolve, reject) => {
            chrome.browsingData.remove(
                { origins: [origin] },
                { cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true, fileSystems: true },
                () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()
            );
        });
    }

    async function deleteAllSiteData() {
        if (!confirm(i18n.getMessage('confirmDeleteSiteData'))) return;
        const button = document.getElementById('delete-site-data-btn');
        button.disabled = true;
        try {
            await Promise.all(currentData.cookies.map(removeCookie));
            await executeOnPage(async () => {
                localStorage.clear();
                sessionStorage.clear();
                if (typeof indexedDB.databases === 'function') {
                    for (const database of await indexedDB.databases()) {
                        if (database.name) indexedDB.deleteDatabase(database.name);
                    }
                }
                if ('caches' in globalThis) await Promise.all((await caches.keys()).map(name => caches.delete(name)));
                if ('serviceWorker' in navigator) await Promise.all((await navigator.serviceWorker.getRegistrations()).map(registration => registration.unregister()));
                if (navigator.storage?.getDirectory) {
                    const root = await navigator.storage.getDirectory();
                    for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true });
                }
            });
            await clearBrowsingData(new URL(activeTab.url).origin);
            for (const section of sectionDefinitions) {
                if (section.mutable) currentData[section.id] = [];
            }
            renderWorkspace();
            showBanner(i18n.getMessage('siteDataDeleted'), 'info');
            chrome.tabs.reload(activeTab.id);
        } catch (error) {
            showBanner(`${i18n.getMessage('deleteFailed')}: ${error.message}`, 'error');
            button.disabled = false;
        }
    }

    function applySearch() {
        const term = searchBox.value.trim().toLowerCase();
        listElement.querySelectorAll('.data-item').forEach(row => row.classList.toggle('hidden', !row.dataset.search.includes(term)));
    }

    function debounce(func, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => func(...args), delay);
        };
    }

    function initializeTabInfo() {
        const params = new URLSearchParams(location.search);
        const id = Number(params.get('tabId'));
        const url = params.get('url') || '';
        if (!id || !url) throw new Error(i18n.getMessage('errorTabId'));
        activeTab = { id, url, title: params.get('title') || '' };
        document.getElementById('tab-title').textContent = activeTab.title || activeTab.url;
        const urlElement = document.getElementById('tab-url');
        urlElement.textContent = new URL(activeTab.url).hostname;
        urlElement.href = activeTab.url;
        document.getElementById('fetch-time').textContent = `${i18n.getMessage('fetchedAt')} ${new Date().toLocaleTimeString()}`;
    }

    async function main() {
        await loadMessages();
        const languageSelector = document.getElementById('language-selector');
        const { userLanguage } = await chrome.storage.sync.get('userLanguage');
        const browserLanguage = chrome.i18n.getUILanguage().split('-')[0];
        currentLang = userLanguage || (languages.includes(browserLanguage) ? browserLanguage : 'en');
        languageSelector.value = currentLang;
        localizeHtmlPage(currentLang);
        initializeTabInfo();
        await loadData();

        languageSelector.addEventListener('change', event => {
            chrome.storage.sync.set({ userLanguage: event.target.value });
            localizeHtmlPage(event.target.value);
        });
        searchBox.addEventListener('input', debounce(applySearch, 120));
        document.getElementById('delete-site-data-btn').addEventListener('click', deleteAllSiteData);
        document.getElementById('version-display').textContent = `Version ${chrome.runtime.getManifest().version}`;
    }

    main().catch(error => showBanner(error.message, 'error'));
});
