// ==UserScript==
// @name         【自写】通用请求抓包记录器
// @namespace    bbshelperforme
// @version      0.1.0
// @description  通用 fetch/XHR/sendBeacon 请求记录工具，按站点启用后可导出接口日志
// @author       Ice_wilderness
// @match        *://*/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG_KEY = 'UniversalApiCaptureConfig';
    const LOG_KEY_PREFIX = 'UniversalApiCaptureLogs:';
    const MAX_LOGS = 300;
    const BODY_LIMIT = 2000;
    const RESPONSE_LIMIT = 5000;
    const SENSITIVE_KEY_RE = /authorization|cookie|token|secret|password|passwd|csrf|xsrf|session|jwt|bearer/i;
    const TEXT_RESPONSE_RE = /json|text|xml|html|javascript|form|plain/i;
    const requestSubmitSubmitters = new WeakMap();

    function readObject(key, fallback = {}) {
        const value = GM_getValue(key);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return JSON.parse(JSON.stringify(fallback));
        }
        return value;
    }

    function getConfig() {
        const config = readObject(CONFIG_KEY, { enabledHosts: {} });
        return {
            enabledHosts: config.enabledHosts && typeof config.enabledHosts === 'object' ? config.enabledHosts : {}
        };
    }

    function saveConfig(config) {
        GM_setValue(CONFIG_KEY, {
            enabledHosts: config.enabledHosts || {}
        });
    }

    function getHostKey() {
        return location.hostname || 'unknown-host';
    }

    function getLogKey() {
        return `${LOG_KEY_PREFIX}${getHostKey()}`;
    }

    function isCurrentHostEnabled() {
        return getConfig().enabledHosts[getHostKey()] === true;
    }

    function sanitizeUrl(value) {
        try {
            const url = new URL(String(value), location.href);
            for (const key of Array.from(url.searchParams.keys())) {
                if (SENSITIVE_KEY_RE.test(key)) {
                    url.searchParams.set(key, '[REDACTED]');
                }
            }
            return url.href;
        } catch (err) {
            return String(value || '');
        }
    }

    function redactSensitiveText(value) {
        return String(value || '')
            .replace(/("(?:[^"\\]|\\.)*(?:authorization|cookie|token|secret|password|passwd|csrf|xsrf|session|jwt|bearer)(?:[^"\\]|\\.)*"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
            .replace(/((?:authorization|cookie|token|secret|password|passwd|csrf|xsrf|session|jwt|bearer)=)[^&\s]+/gi, '$1[REDACTED]');
    }

    function truncate(value, limit) {
        const text = String(value || '');
        if (text.length <= limit) return text;
        return `${text.slice(0, limit)}... [truncated ${text.length - limit} chars]`;
    }

    function normalizeHeaderValue(value, key = '') {
        if (SENSITIVE_KEY_RE.test(key)) return '[REDACTED]';
        return truncate(redactSensitiveText(value), BODY_LIMIT);
    }

    function headersToObject(headers) {
        const result = {};
        if (!headers) return result;

        try {
            const normalized = new Headers(headers);
            normalized.forEach((value, key) => {
                result[key] = normalizeHeaderValue(value, key);
            });
        } catch (err) {
            if (headers && typeof headers === 'object') {
                for (const [key, value] of Object.entries(headers)) {
                    result[key] = normalizeHeaderValue(value, key);
                }
            }
        }
        return result;
    }

    function getObjectTag(value) {
        return Object.prototype.toString.call(value);
    }

    function isFileLike(value) {
        const tag = getObjectTag(value);
        return tag === '[object File]' || (
            tag === '[object Blob]' &&
            typeof value.name === 'string'
        );
    }

    function bodyToText(body) {
        if (body === undefined || body === null) return '';
        const tag = getObjectTag(body);
        if (typeof body === 'string') return truncate(redactSensitiveText(body), BODY_LIMIT);
        if (tag === '[object URLSearchParams]') return truncate(redactSensitiveText(body.toString()), BODY_LIMIT);
        if (tag === '[object FormData]') {
            const data = {};
            body.forEach((value, key) => {
                if (SENSITIVE_KEY_RE.test(key)) {
                    data[key] = '[REDACTED]';
                } else if (isFileLike(value)) {
                    data[key] = `[File name=${value.name} type=${value.type || 'unknown'} size=${value.size}]`;
                } else {
                    data[key] = truncate(redactSensitiveText(value), BODY_LIMIT);
                }
            });
            return truncate(JSON.stringify(data), BODY_LIMIT);
        }
        if (tag === '[object Blob]' || tag === '[object File]') return `[${tag.slice(8, -1)} type=${body.type || 'unknown'} size=${body.size}]`;
        if (tag === '[object ArrayBuffer]') return `[ArrayBuffer byteLength=${body.byteLength}]`;
        if (ArrayBuffer.isView(body)) return `[${body.constructor?.name || 'TypedArray'} byteLength=${body.byteLength}]`;
        try {
            return truncate(redactSensitiveText(JSON.stringify(body)), BODY_LIMIT);
        } catch (err) {
            return `[${Object.prototype.toString.call(body)}]`;
        }
    }

    function getElementName(element) {
        return String(element?.getAttribute?.('name') || element?.name || '');
    }

    function getElementValue(element) {
        if (!element) return '';
        const name = getElementName(element);
        if (SENSITIVE_KEY_RE.test(name) || element.type === 'password') return '[REDACTED]';
        return truncate(redactSensitiveText(element.value || ''), BODY_LIMIT);
    }

    function getFormData(form, submitter) {
        try {
            if (submitter) return new FormData(form, submitter);
        } catch (err) {
            // Older engines may not support the submitter argument.
        }
        return new FormData(form);
    }

    function serializeFormValue(key, value) {
        if (SENSITIVE_KEY_RE.test(key)) return '[REDACTED]';
        if (isFileLike(value)) return `[File name=${value.name} type=${value.type || 'unknown'} size=${value.size}]`;
        return truncate(redactSensitiveText(value), BODY_LIMIT);
    }

    function appendDataValue(data, key, value) {
        if (key in data) {
            data[key] = Array.isArray(data[key]) ? [...data[key], value] : [data[key], value];
        } else {
            data[key] = value;
        }
    }

    function collectFormData(form, submitter) {
        const data = {};
        try {
            getFormData(form, submitter).forEach((value, key) => {
                appendDataValue(data, key, serializeFormValue(key, value));
            });
        } catch (err) {
            Array.from(form?.elements || []).forEach(element => {
                const name = getElementName(element);
                if (!name || element.disabled) return;
                if ((element.type === 'checkbox' || element.type === 'radio') && !element.checked) return;
                appendDataValue(data, name, getElementValue(element));
            });
        }

        const submitterName = getElementName(submitter);
        if (submitterName && !(submitterName in data)) {
            data[submitterName] = getElementValue(submitter);
        }

        return data;
    }

    function formToText(form, submitter) {
        return truncate(JSON.stringify(collectFormData(form, submitter)), BODY_LIMIT);
    }

    function appendFormDataToUrl(url, form, submitter) {
        try {
            getFormData(form, submitter).forEach((value, key) => {
                url.searchParams.append(key, serializeFormValue(key, value));
            });
        } catch (err) {
            for (const [key, value] of Object.entries(collectFormData(form, submitter))) {
                const values = Array.isArray(value) ? value : [value];
                values.forEach(item => url.searchParams.append(key, item));
            }
        }
    }

    function getSubmitterOverride(submitter, attrName, propName) {
        const attr = submitter?.getAttribute?.(attrName);
        if (attr !== undefined && attr !== null && attr !== '') return attr;
        const prop = submitter?.[propName];
        return prop || '';
    }

    function getFormAction(form, submitter) {
        return getSubmitterOverride(submitter, 'formaction', 'formAction') ||
            form?.getAttribute?.('action') ||
            form?.action ||
            location.href;
    }

    function getFormMethod(form, submitter) {
        return String(
            getSubmitterOverride(submitter, 'formmethod', 'formMethod') ||
            form?.getAttribute?.('method') ||
            form?.method ||
            'GET'
        ).toUpperCase();
    }

    function getFormEnctype(form, submitter) {
        return getSubmitterOverride(submitter, 'formenctype', 'formEnctype') ||
            form?.enctype ||
            form?.getAttribute?.('enctype') ||
            '';
    }

    function getFormTarget(form, submitter) {
        return getSubmitterOverride(submitter, 'formtarget', 'formTarget') ||
            form?.target ||
            '';
    }

    function getSubmitter(form) {
        try {
            return form?.ownerDocument?.activeElement?.closest?.('button, input, textarea, select');
        } catch (err) {
            return null;
        }
    }

    function logFormSubmit(form, submitter, source) {
        if (!form || form.nodeType !== 1) return;
        const method = getFormMethod(form, submitter);
        const actionUrl = new URL(getFormAction(form, submitter), location.href);
        if (method === 'GET') {
            appendFormDataToUrl(actionUrl, form, submitter);
        }
        saveLog({
            type: 'form-submit',
            source,
            method,
            url: sanitizeUrl(actionUrl.href),
            requestHeaders: {},
            requestBody: method === 'GET' ? '' : formToText(form, submitter),
            formMeta: {
                id: form.id || '',
                name: form.getAttribute('name') || '',
                enctype: getFormEnctype(form, submitter),
                target: getFormTarget(form, submitter)
            },
            status: 'navigation',
            response: '[document navigation not captured]'
        });
    }

    function saveLog(entry) {
        const logs = GM_getValue(getLogKey(), []);
        const safeLogs = Array.isArray(logs) ? logs : [];
        safeLogs.push({
            ...entry,
            host: getHostKey(),
            pageUrl: sanitizeUrl(location.href),
            time: new Date().toISOString()
        });
        GM_setValue(getLogKey(), safeLogs.slice(-MAX_LOGS));
    }

    function buildExportPayload() {
        return {
            tool: 'UniversalApiCapture',
            host: getHostKey(),
            origin: location.origin,
            enabled: isCurrentHostEnabled(),
            exportedAt: new Date().toISOString(),
            logs: GM_getValue(getLogKey(), [])
        };
    }

    function getExportFileName() {
        const host = getHostKey().replace(/[^\w.-]+/g, '_');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `api-capture-${host}-${timestamp}.json`;
    }

    function downloadExport() {
        const text = JSON.stringify(buildExportPayload(), null, 2);
        const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = getExportFileName();
        link.style.display = 'none';
        (document.body || document.documentElement).append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function enableCurrentHost() {
        const config = getConfig();
        config.enabledHosts[getHostKey()] = true;
        saveConfig(config);
        location.reload();
    }

    function disableCurrentHost() {
        const config = getConfig();
        delete config.enabledHosts[getHostKey()];
        saveConfig(config);
    }

    function clearCurrentLogs() {
        GM_deleteValue(getLogKey());
    }

    function registerMenus() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        if (isCurrentHostEnabled()) {
            GM_registerMenuCommand('抓包：暂停当前站点（刷新生效）', disableCurrentHost);
        } else {
            GM_registerMenuCommand('抓包：启用当前站点并刷新', enableCurrentHost);
        }
        GM_registerMenuCommand('抓包：下载当前站点日志文件', downloadExport);
        GM_registerMenuCommand('抓包：清空当前站点日志', clearCurrentLogs);
    }

    function installFetchHook(w) {
        if (typeof w.fetch !== 'function') return;
        const rawFetch = w.fetch;

        w.fetch = async function (input, init = {}) {
            const startedAt = Date.now();
            const requestUrl = typeof input === 'string' ? input : input?.url;
            const method = init.method || input?.method || 'GET';
            const requestHeaders = {
                ...headersToObject(input?.headers),
                ...headersToObject(init.headers)
            };
            const requestBody = init.body !== undefined ? bodyToText(init.body) : '[Request body not captured]';

            try {
                const response = await rawFetch.apply(this, arguments);
                const contentType = response.headers?.get?.('content-type') || '';
                const baseEntry = {
                    type: 'fetch',
                    method,
                    url: sanitizeUrl(requestUrl),
                    requestHeaders,
                    requestBody,
                    status: response.status,
                    ok: response.ok,
                    responseType: contentType,
                    durationMs: Date.now() - startedAt
                };

                if (TEXT_RESPONSE_RE.test(contentType)) {
                    response.clone().text()
                        .then(text => saveLog({
                            ...baseEntry,
                            response: truncate(redactSensitiveText(text), RESPONSE_LIMIT)
                        }))
                        .catch(err => saveLog({
                            ...baseEntry,
                            responseError: err?.message || String(err)
                        }));
                } else {
                    saveLog({
                        ...baseEntry,
                        response: contentType ? `[${contentType} body omitted]` : '[body omitted]'
                    });
                }
                return response;
            } catch (err) {
                saveLog({
                    type: 'fetch',
                    method,
                    url: sanitizeUrl(requestUrl),
                    requestHeaders,
                    requestBody,
                    error: err?.message || String(err),
                    durationMs: Date.now() - startedAt
                });
                throw err;
            }
        };
    }

    function installXhrHook(w) {
        const proto = w.XMLHttpRequest?.prototype;
        if (!proto) return;

        const rawOpen = proto.open;
        const rawSetRequestHeader = proto.setRequestHeader;
        const rawSend = proto.send;

        proto.open = function (method, url) {
            this.__apiCapture = {
                method,
                url,
                requestHeaders: {},
                startedAt: 0
            };
            return rawOpen.apply(this, arguments);
        };

        proto.setRequestHeader = function (key, value) {
            if (this.__apiCapture) {
                this.__apiCapture.requestHeaders[key] = normalizeHeaderValue(value, key);
            }
            return rawSetRequestHeader.apply(this, arguments);
        };

        proto.send = function (body) {
            const capture = this.__apiCapture || {};
            capture.requestBody = bodyToText(body);
            capture.startedAt = Date.now();

            this.addEventListener('loadend', () => {
                let response = '';
                if (!this.responseType || this.responseType === 'text' || this.responseType === 'json') {
                    try {
                        response = typeof this.responseText === 'string'
                            ? truncate(redactSensitiveText(this.responseText), RESPONSE_LIMIT)
                            : truncate(redactSensitiveText(JSON.stringify(this.response)), RESPONSE_LIMIT);
                    } catch (err) {
                        response = `[response unavailable: ${err?.message || err}]`;
                    }
                } else {
                    response = `[${this.responseType} response omitted]`;
                }

                saveLog({
                    type: 'xhr',
                    method: capture.method || '',
                    url: sanitizeUrl(capture.url),
                    requestHeaders: capture.requestHeaders || {},
                    requestBody: capture.requestBody || '',
                    status: this.status,
                    responseType: this.getResponseHeader?.('content-type') || this.responseType || '',
                    response,
                    durationMs: capture.startedAt ? Date.now() - capture.startedAt : 0
                });
            });

            return rawSend.apply(this, arguments);
        };
    }

    function installFormHook(w) {
        document.addEventListener('submit', (event) => {
            const submitter = event.submitter ||
                requestSubmitSubmitters.get(event.target) ||
                getSubmitter(event.target);
            logFormSubmit(event.target, submitter, 'submit-event');
        }, true);

        const proto = w.HTMLFormElement?.prototype;
        if (!proto) return;

        const rawSubmit = proto.submit;
        if (typeof rawSubmit === 'function') {
            proto.submit = function () {
                logFormSubmit(this, getSubmitter(this), 'form-submit-method');
                return rawSubmit.apply(this, arguments);
            };
        }

        const rawRequestSubmit = proto.requestSubmit;
        if (typeof rawRequestSubmit === 'function') {
            proto.requestSubmit = function (submitter) {
                requestSubmitSubmitters.set(this, submitter || getSubmitter(this));
                try {
                    return rawRequestSubmit.apply(this, arguments);
                } finally {
                    setTimeout(() => requestSubmitSubmitters.delete(this), 0);
                }
            };
        }
    }

    function installNavigationHook() {
        document.addEventListener('click', (event) => {
            const link = event.target?.closest?.('a[href]');
            if (!link) return;
            saveLog({
                type: 'link-click',
                method: 'GET',
                url: sanitizeUrl(link.href),
                requestHeaders: {},
                requestBody: '',
                linkMeta: {
                    id: link.id || '',
                    text: truncate((link.textContent || '').trim(), 300),
                    target: link.target || ''
                },
                status: 'navigation',
                response: '[document navigation not captured]'
            });
        }, true);
    }

    function installBeaconHook(w) {
        const rawBeacon = w.navigator?.sendBeacon;
        if (typeof rawBeacon !== 'function') return;

        w.navigator.sendBeacon = function (url, body) {
            const result = rawBeacon.apply(this, arguments);
            saveLog({
                type: 'beacon',
                method: 'POST',
                url: sanitizeUrl(url),
                requestHeaders: {},
                requestBody: bodyToText(body),
                status: result ? 'queued' : 'rejected',
                response: ''
            });
            return result;
        };
    }

    function installHooks() {
        const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        if (w.__universalApiCaptureInstalled) return;
        Object.defineProperty(w, '__universalApiCaptureInstalled', {
            value: true,
            configurable: false,
            enumerable: false
        });

        installFetchHook(w);
        installXhrHook(w);
        installFormHook(w);
        installNavigationHook();
        installBeaconHook(w);
    }

    registerMenus();
    if (isCurrentHostEnabled()) {
        installHooks();
    }
})();
