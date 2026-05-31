(function () {
  "use strict";

  var GLOBAL_NAME = "__signinApiDiscovery";
  var BOOTSTRAP_NAME = "__SIGNIN_API_DISCOVERY_BOOTSTRAP";
  var STORAGE_KEY = "__signinApiDiscoverySessionV1";
  var VERSION = "0.1.0";
  var MAX_TEXT = 1600;
  var MAX_ITEMS = 80;
  var SENSITIVE_NAME_RE = /(cookie|authorization|passwd|password|token|csrf|xsrf|formhash|auth|secret|session|sessid|sid|email|e-mail|mail|username|user_name|account|phone|mobile|invite)/i;
  var SIGN_HINT_RE = /(签到|簽到|打卡|寻宝|尋寶|check\s*in|signin|sign\s*in|daily|领取|領取)/i;
  var SIGN_ACTION_RE = /(JD_sign|k_misign|operation=(?:qiandao|sign)|qiandao|check[-_ ]?in|sign[-_ ]?in|daily|签到|簽到|打卡|寻宝|尋寶|领取|領取)/i;
  var DONE_HINT_RE = /(已签到|已簽到|已经签到|已經簽到|今日已|already\s+(signed|checked)|signed\s+today|checked\s+in)/i;

  if (window[GLOBAL_NAME] && window[GLOBAL_NAME].version) {
    return;
  }

  var originalFetch = window.fetch;
  var OriginalXHR = window.XMLHttpRequest;
  var originalSendBeacon = window.navigator && window.navigator.sendBeacon;
  var OriginalHTMLFormElement = window.HTMLFormElement;
  var originalFormSubmit = OriginalHTMLFormElement && OriginalHTMLFormElement.prototype && OriginalHTMLFormElement.prototype.submit;
  var originalRequestSubmit = OriginalHTMLFormElement && OriginalHTMLFormElement.prototype && OriginalHTMLFormElement.prototype.requestSubmit;
  var originalWindowOpen = window.open;
  var lastSubmitter = null;
  var session = restoreSession() || createSession({});

  function isoNow() {
    return new Date().toISOString();
  }

  function createSession(options) {
    options = options || {};
    return {
      active: false,
      target: options.target || "",
      host: options.host || safeLocationHost(),
      url: options.url || safeLocationHref(),
      note: options.note || "",
      startedAt: "",
      stoppedAt: "",
      networkCandidates: [],
      formSubmissions: [],
      actionCandidates: [],
      pageClues: emptyPageClues()
    };
  }

  function restoreSession() {
    try {
      if (!window.sessionStorage) return null;
      var raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      parsed.networkCandidates = Array.isArray(parsed.networkCandidates) ? parsed.networkCandidates : [];
      parsed.formSubmissions = Array.isArray(parsed.formSubmissions) ? parsed.formSubmissions : [];
      parsed.actionCandidates = Array.isArray(parsed.actionCandidates) ? parsed.actionCandidates : [];
      parsed.pageClues = parsed.pageClues || emptyPageClues();
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function persistSession() {
    try {
      if (!window.sessionStorage) return;
      window.sessionStorage.setItem(STORAGE_KEY, safeJson(session));
    } catch (err) {}
  }

  function clearPersistedSession() {
    try {
      if (window.sessionStorage) window.sessionStorage.removeItem(STORAGE_KEY);
    } catch (err) {}
  }

  function emptyPageClues() {
    return {
      title: safeDocumentTitle(),
      url: safeLocationHref(),
      forms: [],
      buttons: [],
      tokenFields: [],
      alreadySignedText: []
    };
  }

  function safeLocationHref() {
    try {
      return String(window.location && window.location.href || "");
    } catch (err) {
      return "";
    }
  }

  function safeLocationHost() {
    try {
      return String(window.location && window.location.host || "");
    } catch (err) {
      return "";
    }
  }

  function safeDocumentTitle() {
    try {
      return String(document && document.title || "");
    } catch (err) {
      return "";
    }
  }

  function absoluteUrl(value) {
    try {
      return new URL(String(value || ""), safeLocationHref()).href;
    } catch (err) {
      return String(value || "");
    }
  }

  function redactUrl(value) {
    var raw = String(value || "");
    if (!raw) return "";
    try {
      var url = new URL(raw, safeLocationHref());
      Array.from(url.searchParams.keys()).forEach(function (name) {
        if (isSensitiveName(name)) {
          url.searchParams.set(name, "[REDACTED]");
        }
      });
      return url.href;
    } catch (err) {
      return redactPlainText(raw);
    }
  }

  function truncate(value, max) {
    var text = String(value == null ? "" : value);
    var limit = max || MAX_TEXT;
    if (text.length <= limit) return text;
    return text.slice(0, limit) + "...[truncated " + (text.length - limit) + " chars]";
  }

  function isSensitiveName(name) {
    return SENSITIVE_NAME_RE.test(String(name || ""));
  }

  function redactText(text) {
    var raw = String(text == null ? "" : text);
    var parsed = parseJsonLike(raw);
    if (parsed.ok) {
      return truncate(safeJson(redactStructuredValue(parsed.value)));
    }
    return truncate(redactPlainText(raw));
  }

  function redactPlainText(text) {
    return String(text || "")
      .replace(/(<[^>]+\bname=["']?(?:cookie|authorization|passwd|password|token|csrf|xsrf|formhash|auth|secret|session|sessid|sid|email|e-mail|mail|username|user_name|account|phone|mobile|invite)["']?[^>]*\bvalue=["'])([^"']*)/ig, "$1[REDACTED]")
      .replace(/((?:cookie|authorization)\s*[:=]\s*)([^;\n\r]+)/ig, "$1[REDACTED]")
      .replace(/((?:passwd|password|token|csrf|xsrf|formhash|auth|secret|session|sessid|sid|email|e-mail|mail|username|user_name|account|phone|mobile|invite)\w*\s*[:=]\s*)([^&\s"'<>]+)/ig, "$1[REDACTED]")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig, "[REDACTED_EMAIL]");
  }

  function parseJsonLike(text) {
    var trimmed = String(text || "").trim();
    if (!trimmed || !/^[\[{]/.test(trimmed)) return { ok: false };
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch (err) {
      return { ok: false };
    }
  }

  function redactStructuredValue(value, key) {
    if (isSensitiveName(key)) {
      return {
        redacted: true,
        reason: "sensitive-response-field",
        length: valueLength(value)
      };
    }

    if (Array.isArray(value)) {
      return value.slice(0, MAX_ITEMS).map(function (item) {
        return redactStructuredValue(item);
      });
    }

    if (value && typeof value === "object") {
      var output = {};
      Object.keys(value).slice(0, MAX_ITEMS).forEach(function (name) {
        output[name] = redactStructuredValue(value[name], name);
      });
      if (Object.keys(value).length > MAX_ITEMS) {
        output.__truncatedKeys = Object.keys(value).length - MAX_ITEMS;
      }
      return output;
    }

    if (typeof value === "string") {
      return redactPlainText(value);
    }

    return value;
  }

  function valueLength(value) {
    if (value == null) return 0;
    if (typeof value === "string") return value.length;
    if (typeof value === "number" || typeof value === "boolean") return String(value).length;
    if (typeof Blob !== "undefined" && value instanceof Blob) return value.size || 0;
    try {
      return JSON.stringify(value).length;
    } catch (err) {
      return String(value).length;
    }
  }

  function summarizeValue(name, value) {
    var length = valueLength(value);
    if (isSensitiveName(name)) {
      return {
        redacted: true,
        reason: "sensitive-field",
        length: length
      };
    }
    if (value == null) return { value: "", length: 0 };
    if (typeof Blob !== "undefined" && value instanceof Blob) {
      return {
        type: "blob",
        mimeType: value.type || "",
        length: value.size || 0
      };
    }
    if (typeof File !== "undefined" && value instanceof File) {
      return {
        type: "file",
        name: value.name,
        mimeType: value.type || "",
        length: value.size || 0
      };
    }
    if (typeof value === "string") {
      return {
        value: redactText(value),
        length: length
      };
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return {
        value: value,
        length: length
      };
    }
    return {
      value: redactText(safeJson(value)),
      length: length
    };
  }

  function safeJson(value) {
    try {
      return JSON.stringify(value);
    } catch (err) {
      return String(value);
    }
  }

  function summarizeBody(body) {
    if (body == null) return { type: "empty" };

    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      return summarizeEntries("urlsearchparams", Array.from(body.entries()));
    }

    if (typeof FormData !== "undefined" && body instanceof FormData) {
      return summarizeEntries("formdata", Array.from(body.entries()));
    }

    if (typeof body === "string") {
      if (/^\s*[\[{]/.test(body)) {
        return {
          type: "json",
          length: body.length,
          excerpt: redactText(body)
        };
      }
      if (/[=&]/.test(body)) {
        try {
          return summarizeEntries("urlencoded-string", Array.from(new URLSearchParams(body).entries()));
        } catch (err) {}
      }
      return {
        type: "text",
        length: body.length,
        excerpt: redactText(body)
      };
    }

    if (typeof Blob !== "undefined" && body instanceof Blob) {
      return {
        type: "blob",
        mimeType: body.type || "",
        length: body.size || 0
      };
    }

    return {
      type: Object.prototype.toString.call(body),
      length: valueLength(body),
      excerpt: redactText(safeJson(body))
    };
  }

  function summarizeEntries(type, entries) {
    var fields = {};
    entries.slice(0, MAX_ITEMS).forEach(function (entry) {
      fields[String(entry[0])] = summarizeValue(entry[0], entry[1]);
    });
    return {
      type: type,
      fieldCount: entries.length,
      fields: fields,
      truncated: entries.length > MAX_ITEMS
    };
  }

  function summarizeHeaders(headersLike) {
    var result = {};
    if (!headersLike) return result;

    function setHeader(name, value) {
      var key = String(name || "");
      result[key] = isSensitiveName(key)
        ? { redacted: true, reason: "sensitive-header", length: valueLength(value) }
        : summarizeValue(key, String(value || ""));
    }

    try {
      if (typeof Headers !== "undefined" && headersLike instanceof Headers) {
        headersLike.forEach(function (value, name) {
          setHeader(name, value);
        });
        return result;
      }
    } catch (err) {}

    if (Array.isArray(headersLike)) {
      headersLike.forEach(function (pair) {
        if (pair && pair.length >= 2) setHeader(pair[0], pair[1]);
      });
      return result;
    }

    if (typeof headersLike === "object") {
      Object.keys(headersLike).forEach(function (name) {
        setHeader(name, headersLike[name]);
      });
    }

    return result;
  }

  function getFetchRequestInfo(input, init) {
    init = init || {};
    var method = init.method || "GET";
    var url = "";
    var headers = init.headers;

    try {
      if (typeof Request !== "undefined" && input instanceof Request) {
        url = input.url;
        method = init.method || input.method || method;
        headers = init.headers || input.headers;
      } else {
        url = absoluteUrl(input);
      }
    } catch (err) {
      url = absoluteUrl(input);
    }

    return {
      method: String(method || "GET").toUpperCase(),
      url: redactUrl(absoluteUrl(url)),
      headers: summarizeHeaders(headers),
      body: summarizeBody(init.body)
    };
  }

  function candidateBase(kind, info, startedAt) {
    return {
      kind: kind,
      label: "candidate",
      verified: false,
      needsFutureValidation: true,
      target: session.target,
      host: session.host,
      pageUrl: safeLocationHref(),
      startedAt: startedAt || isoNow(),
      capturedAt: isoNow(),
      request: info
    };
  }

  function pushLimited(list, item) {
    list.push(item);
    if (list.length > MAX_ITEMS) list.shift();
    persistSession();
  }

  function captureFetch(input, init) {
    if (!session.active || typeof originalFetch !== "function") {
      return originalFetch.apply(this, arguments);
    }

    var startedAt = isoNow();
    var info = getFetchRequestInfo(input, init);
    return originalFetch.apply(this, arguments).then(function (response) {
      var record = candidateBase("fetch", info, startedAt);
      record.response = {
        status: response && response.status,
        ok: Boolean(response && response.ok),
        url: response && response.url ? redactUrl(absoluteUrl(response.url)) : info.url
      };
      try {
        return response.clone().text().then(function (text) {
          record.response.excerpt = redactText(text);
          pushLimited(session.networkCandidates, record);
          return response;
        }, function () {
          pushLimited(session.networkCandidates, record);
          return response;
        });
      } catch (err) {
        pushLimited(session.networkCandidates, record);
        return response;
      }
    }, function (err) {
      var record = candidateBase("fetch", info, startedAt);
      record.error = err && err.message ? err.message : String(err);
      pushLimited(session.networkCandidates, record);
      throw err;
    });
  }

  function DiscoveryXMLHttpRequest() {
    var xhr = new OriginalXHR();
    var info = {
      method: "GET",
      url: "",
      headers: {},
      body: { type: "empty" }
    };
    var startedAt = "";

    var originalOpen = xhr.open;
    xhr.open = function (method, url) {
      info.method = String(method || "GET").toUpperCase();
      info.url = redactUrl(absoluteUrl(url));
      return originalOpen.apply(xhr, arguments);
    };

    var originalSetRequestHeader = xhr.setRequestHeader;
    xhr.setRequestHeader = function (name, value) {
      info.headers[name] = isSensitiveName(name)
        ? { redacted: true, reason: "sensitive-header", length: valueLength(value) }
        : summarizeValue(name, value);
      return originalSetRequestHeader.apply(xhr, arguments);
    };

    var originalSend = xhr.send;
    xhr.send = function (body) {
      if (session.active) {
        startedAt = isoNow();
        info.body = summarizeBody(body);
        xhr.addEventListener("loadend", function () {
          var record = candidateBase("xhr", info, startedAt);
          record.response = {
            status: xhr.status,
            url: info.url,
            excerpt: safeXhrText(xhr)
          };
          pushLimited(session.networkCandidates, record);
        });
      }
      return originalSend.apply(xhr, arguments);
    };

    return xhr;
  }

  function safeXhrText(xhr) {
    try {
      if (xhr.responseType && xhr.responseType !== "text" && xhr.responseType !== "") {
        return "[non-text responseType: " + xhr.responseType + "]";
      }
      return redactText(xhr.responseText || "");
    } catch (err) {
      return "[response unavailable]";
    }
  }

  function describeElement(el) {
    if (!el) return null;
    return {
      tag: String(el.tagName || "").toLowerCase(),
      type: el.type || "",
      name: el.name || "",
      id: el.id || "",
      className: typeof el.className === "string" ? el.className : "",
      text: truncate((el.innerText || el.textContent || el.value || "").trim(), 160),
      title: elementAttr(el, "title"),
      ariaLabel: elementAttr(el, "aria-label"),
      href: redactUrl(el.href || elementAttr(el, "href") || ""),
      onclick: truncate(redactPlainText(elementAttr(el, "onclick")), 320),
      attrs: selectedElementAttrs(el),
      selector: cssPath(el)
    };
  }

  function cssPath(el) {
    try {
      if (!el || !el.tagName) return "";
      if (el.id) return "#" + cssEscape(el.id);
      var parts = [];
      var node = el;
      while (node && node.nodeType === 1 && parts.length < 5) {
        var part = String(node.tagName).toLowerCase();
        if (node.className && typeof node.className === "string") {
          var firstClass = node.className.trim().split(/\s+/)[0];
          if (firstClass) part += "." + cssEscape(firstClass);
        }
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(" > ");
    } catch (err) {
      return "";
    }
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function elementAttr(el, name) {
    try {
      return el.getAttribute(name) || "";
    } catch (err) {
      return "";
    }
  }

  function selectedElementAttrs(el) {
    var attrs = {};
    [
      "data-url",
      "data-href",
      "data-action",
      "data-ajax",
      "data-target",
      "data-id",
      "rel"
    ].forEach(function (name) {
      var value = elementAttr(el, name);
      if (value) attrs[name] = truncate(redactPlainText(value), 320);
    });
    return attrs;
  }

  function elementSignal(el) {
    if (!el) return "";
    return [
      el.id || "",
      typeof el.className === "string" ? el.className : "",
      el.name || "",
      el.href || "",
      elementAttr(el, "href"),
      elementAttr(el, "onclick"),
      elementAttr(el, "title"),
      elementAttr(el, "aria-label"),
      elementAttr(el, "data-url"),
      elementAttr(el, "data-href"),
      elementAttr(el, "data-action"),
      elementAttr(el, "data-ajax"),
      el.innerText || el.textContent || el.value || ""
    ].join(" ");
  }

  function isLikelySignAction(el) {
    return SIGN_ACTION_RE.test(elementSignal(el));
  }

  function getFormFields(form) {
    var elements = [];
    try {
      elements = Array.from(form.querySelectorAll("input, textarea, select"));
    } catch (err) {}

    return elements.slice(0, MAX_ITEMS).map(function (el) {
      var name = el.name || elementAttr(el, "name") || "";
      return {
        tag: String(el.tagName || "").toLowerCase(),
        type: el.type || elementAttr(el, "type") || "",
        name: name,
        id: el.id || "",
        selector: cssPath(el),
        value: summarizeValue(name, el.value || elementAttr(el, "value") || "")
      };
    });
  }

  function captureForm(form, submitter, source) {
    if (!form) return null;
    var fields = getFormFields(form);
    return {
      kind: source || "form",
      label: "candidate",
      verified: false,
      needsFutureValidation: true,
      target: session.target,
      host: session.host,
      pageUrl: safeLocationHref(),
      capturedAt: isoNow(),
      form: {
        action: redactUrl(absoluteUrl(form.action || elementAttr(form, "action") || safeLocationHref())),
        method: String(form.method || elementAttr(form, "method") || "GET").toUpperCase(),
        id: form.id || "",
        selector: cssPath(form),
        fieldCount: fields.length,
        fields: fields,
        hiddenFields: fields.filter(function (field) {
          return String(field.type || "").toLowerCase() === "hidden";
        })
      },
      submitter: describeElement(submitter)
    };
  }

  function onDocumentClick(event) {
    var target = event && event.target;
    if (!target || !target.closest) return;
    lastSubmitter = target.closest("button, input[type='submit'], input[type='button'], a, [role='button']");
    if (session.active && lastSubmitter && isLikelySignAction(lastSubmitter)) {
      pushLimited(session.actionCandidates, captureAction("click", lastSubmitter));
    }
  }

  function onFormSubmit(event) {
    if (!session.active) return;
    var form = event && event.target;
    var submitter = event && event.submitter || lastSubmitter;
    var record = captureForm(form, submitter, "form-submit");
    if (record) pushLimited(session.formSubmissions, record);
  }

  function captureAction(kind, el, extra) {
    var record = {
      kind: kind,
      label: "candidate",
      verified: false,
      needsFutureValidation: true,
      target: session.target,
      host: session.host,
      pageUrl: safeLocationHref(),
      capturedAt: isoNow(),
      element: describeElement(el)
    };
    if (extra) record.extra = extra;
    return record;
  }

  function captureSendBeacon(url, data) {
    var startedAt = isoNow();
    var info = {
      method: "POST",
      url: redactUrl(absoluteUrl(url)),
      headers: {},
      body: summarizeBody(data)
    };
    var result = originalSendBeacon.apply(window.navigator, arguments);
    if (session.active) {
      var record = candidateBase("sendBeacon", info, startedAt);
      record.response = {
        ok: Boolean(result),
        result: Boolean(result),
        url: info.url
      };
      pushLimited(session.networkCandidates, record);
    }
    return result;
  }

  function captureProgrammaticFormSubmit(form, submitter, source) {
    if (!session.active) return;
    var record = captureForm(form, submitter || lastSubmitter, source);
    if (record) pushLimited(session.formSubmissions, record);
  }

  function captureWindowOpen(url, target, features) {
    if (session.active) {
      pushLimited(session.actionCandidates, {
        kind: "window-open",
        label: "candidate",
        verified: false,
        needsFutureValidation: true,
        target: session.target,
        host: session.host,
        pageUrl: safeLocationHref(),
        capturedAt: isoNow(),
        url: redactUrl(absoluteUrl(url)),
        windowTarget: target || "",
        features: truncate(features || "", 320)
      });
    }
    return originalWindowOpen.apply(window, arguments);
  }

  function collectStaticPageClues() {
    var clues = emptyPageClues();
    clues.forms = scanForms();
    clues.buttons = scanButtons();
    clues.tokenFields = scanTokenFields();
    clues.alreadySignedText = scanText(DONE_HINT_RE, 12);
    session.pageClues = clues;
    persistSession();
    return clues;
  }

  function scanForms() {
    return safeQueryAll("form").slice(0, 20).map(function (form) {
      var captured = captureForm(form, null, "static-form");
      return captured ? captured.form : null;
    }).filter(Boolean);
  }

  function scanButtons() {
    return safeQueryAll("button, input[type='submit'], input[type='button'], a, [role='button']")
      .filter(function (el) {
        return isLikelySignAction(el);
      })
      .slice(0, 30)
      .map(describeElement);
  }

  function scanTokenFields() {
    return safeQueryAll("input[type='hidden'], meta[name], meta[property]")
      .filter(function (el) {
        return isSensitiveName(el.name || elementAttr(el, "name") || elementAttr(el, "property") || el.id || "");
      })
      .slice(0, 40)
      .map(function (el) {
        var name = el.name || elementAttr(el, "name") || elementAttr(el, "property") || el.id || "";
        var value = el.value || elementAttr(el, "value") || elementAttr(el, "content") || "";
        return {
          tag: String(el.tagName || "").toLowerCase(),
          name: name,
          id: el.id || "",
          selector: cssPath(el),
          value: summarizeValue(name, value)
        };
      });
  }

  function scanText(pattern, limit) {
    var bodyText = "";
    try {
      bodyText = document.body && document.body.innerText || "";
    } catch (err) {}
    return bodyText
      .split(/\n+/)
      .map(function (line) { return line.trim(); })
      .filter(function (line) { return line && pattern.test(line); })
      .slice(0, limit || 10)
      .map(function (line) { return truncate(line, 240); });
  }

  function safeQueryAll(selector) {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch (err) {
      return [];
    }
  }

  function buildUncertaintyNotes(report) {
    var notes = [
      "All captured network requests are candidates and require later validation before site implementation."
    ];
    if (!report.networkCandidates.length && !report.formSubmissions.length) {
      notes.push("No network or form submission candidate was captured in this session.");
    }
    if (report.pageClues.alreadySignedText.length) {
      notes.push("The page appears to contain already-signed text, so this session may not include a real sign-in submission.");
    }
    return notes;
  }

  function buildReport() {
    collectStaticPageClues();
    var report = {
      tool: "signin-api-discovery",
      version: VERSION,
      generatedAt: isoNow(),
      session: {
        target: session.target,
        host: session.host,
        url: session.url,
        pageUrl: safeLocationHref(),
        note: session.note,
        active: session.active,
        startedAt: session.startedAt,
        stoppedAt: session.stoppedAt
      },
      networkCandidates: session.networkCandidates,
      formSubmissions: session.formSubmissions,
      actionCandidates: session.actionCandidates,
      pageClues: session.pageClues,
      implementationBoundary: {
        diagnosticOnly: true,
        writesSuccessStatus: false,
        modifiesSiteConfigs: false
      },
      uncertaintyNotes: []
    };
    report.uncertaintyNotes = buildUncertaintyNotes(report);
    return report;
  }

  function markdownForReport(report) {
    report = report || buildReport();
    var lines = [];
    lines.push("# Sign-in API Discovery Report");
    lines.push("");
    lines.push("- Target: " + (report.session.target || "(unspecified)"));
    lines.push("- Host: " + (report.session.host || "(unknown)"));
    lines.push("- Page: " + (report.session.pageUrl || report.session.url || "(unknown)"));
    lines.push("- Generated: " + report.generatedAt);
    lines.push("- Boundary: diagnostic evidence only; not a confirmed API.");
    lines.push("");
    lines.push("## Network Candidates");
    if (!report.networkCandidates.length) {
      lines.push("");
      lines.push("No network candidates captured.");
    } else {
      report.networkCandidates.forEach(function (item, index) {
        lines.push("");
        lines.push("### Candidate " + (index + 1));
        lines.push("- Kind: " + item.kind);
        lines.push("- Method: " + item.request.method);
        lines.push("- URL: " + item.request.url);
        lines.push("- Status: " + (item.response && item.response.status !== undefined ? item.response.status : "(none)"));
        lines.push("- Verified: false");
        if (item.response && item.response.excerpt) {
          lines.push("- Response excerpt:");
          lines.push("");
          lines.push("```text");
          lines.push(item.response.excerpt);
          lines.push("```");
        }
      });
    }
    lines.push("");
    lines.push("## Form Submissions");
    if (!report.formSubmissions.length) {
      lines.push("");
      lines.push("No form submissions captured.");
    } else {
      report.formSubmissions.forEach(function (item, index) {
        lines.push("");
        lines.push("### Form " + (index + 1));
        lines.push("- Method: " + item.form.method);
        lines.push("- Action: " + item.form.action);
        lines.push("- Fields: " + item.form.fieldCount);
        lines.push("- Hidden fields: " + item.form.hiddenFields.map(function (field) { return field.name || "(unnamed)"; }).join(", "));
      });
    }
    lines.push("");
    lines.push("## Action Candidates");
    if (!report.actionCandidates || !report.actionCandidates.length) {
      lines.push("");
      lines.push("No action candidates captured.");
    } else {
      report.actionCandidates.forEach(function (item, index) {
        lines.push("");
        lines.push("### Action " + (index + 1));
        lines.push("- Kind: " + item.kind);
        if (item.element) {
          lines.push("- Selector: " + (item.element.selector || "(unknown)"));
          lines.push("- Text: " + (item.element.text || "(empty)"));
          if (item.element.id) lines.push("- ID: " + item.element.id);
          if (item.element.href) lines.push("- Href: " + item.element.href);
          if (item.element.onclick) lines.push("- Onclick: " + item.element.onclick);
        }
        if (item.url) lines.push("- URL: " + item.url);
      });
    }
    lines.push("");
    lines.push("## Runner Network Candidates");
    if (!report.runnerNetworkCandidates || !report.runnerNetworkCandidates.length) {
      lines.push("");
      lines.push("No runner network candidates captured.");
    } else {
      report.runnerNetworkCandidates.forEach(function (item, index) {
        lines.push("");
        lines.push("### Runner Candidate " + (index + 1));
        lines.push("- Kind: " + item.kind);
        lines.push("- Method: " + item.request.method);
        lines.push("- URL: " + item.request.url);
        lines.push("- Resource: " + item.request.resourceType);
        lines.push("- Navigation: " + Boolean(item.request.isNavigationRequest));
        lines.push("- Status: " + (item.response && item.response.status !== undefined ? item.response.status : "(none)"));
        if (item.error) lines.push("- Error: " + item.error);
        if (item.response && item.response.excerpt) {
          lines.push("- Response excerpt:");
          lines.push("");
          lines.push("```text");
          lines.push(item.response.excerpt);
          lines.push("```");
        }
      });
    }
    lines.push("");
    lines.push("## Page Clues");
    lines.push("");
    lines.push("- Likely buttons: " + report.pageClues.buttons.length);
    lines.push("- Forms: " + report.pageClues.forms.length);
    lines.push("- Token fields: " + report.pageClues.tokenFields.length);
    if (report.pageClues.buttons.length) {
      lines.push("");
      lines.push("Likely buttons:");
      report.pageClues.buttons.forEach(function (button) {
        var detail = (button.selector || "(unknown)") + " | " + (button.text || "(empty)");
        if (button.href) detail += " | href=" + button.href;
        if (button.onclick) detail += " | onclick=" + button.onclick;
        lines.push("- " + detail);
      });
    }
    if (report.pageClues.alreadySignedText.length) {
      lines.push("");
      lines.push("Already-signed text:");
      report.pageClues.alreadySignedText.forEach(function (text) {
        lines.push("- " + text);
      });
    }
    lines.push("");
    lines.push("## Uncertainty Notes");
    report.uncertaintyNotes.forEach(function (note) {
      lines.push("- " + note);
    });
    return lines.join("\n");
  }

  function download(filename, content, type) {
    var blob = new Blob([content], { type: type || "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function installHooks() {
    if (typeof originalFetch === "function") {
      window.fetch = captureFetch;
    }
    if (typeof OriginalXHR === "function") {
      DiscoveryXMLHttpRequest.prototype = OriginalXHR.prototype;
      try {
        Object.keys(OriginalXHR).forEach(function (key) {
          DiscoveryXMLHttpRequest[key] = OriginalXHR[key];
        });
      } catch (err) {}
      window.XMLHttpRequest = DiscoveryXMLHttpRequest;
    }
    if (window.navigator && typeof originalSendBeacon === "function") {
      window.navigator.sendBeacon = captureSendBeacon;
    }
    if (OriginalHTMLFormElement && originalFormSubmit) {
      OriginalHTMLFormElement.prototype.submit = function () {
        captureProgrammaticFormSubmit(this, lastSubmitter, "form-submit-method");
        return originalFormSubmit.apply(this, arguments);
      };
    }
    if (OriginalHTMLFormElement && originalRequestSubmit) {
      OriginalHTMLFormElement.prototype.requestSubmit = function (submitter) {
        captureProgrammaticFormSubmit(this, submitter || lastSubmitter, "form-request-submit");
        return originalRequestSubmit.apply(this, arguments);
      };
    }
    if (typeof originalWindowOpen === "function") {
      window.open = captureWindowOpen;
    }
    if (document && document.addEventListener) {
      document.addEventListener("click", onDocumentClick, true);
      document.addEventListener("submit", onFormSubmit, true);
    }
  }

  function start(options) {
    session = createSession(options || {});
    session.active = true;
    session.startedAt = isoNow();
    collectStaticPageClues();
    persistSession();
    return {
      active: true,
      target: session.target,
      host: session.host,
      startedAt: session.startedAt,
      message: "Sign-in API discovery is active. Captured data is diagnostic evidence only."
    };
  }

  function stop() {
    session.active = false;
    session.stoppedAt = isoNow();
    collectStaticPageClues();
    persistSession();
    return buildReport();
  }

  function reset() {
    session = createSession({});
    clearPersistedSession();
    return {
      active: false,
      message: "Sign-in API discovery session reset."
    };
  }

  window[GLOBAL_NAME] = {
    version: VERSION,
    start: start,
    stop: stop,
    reset: reset,
    collectPageClues: collectStaticPageClues,
    report: buildReport,
    toMarkdown: markdownForReport,
    copyMarkdown: function () {
      var markdown = markdownForReport();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(markdown).then(function () {
          return markdown;
        });
      }
      console.log(markdown);
      return markdown;
    },
    downloadJson: function () {
      download("signin-api-discovery-report.json", JSON.stringify(buildReport(), null, 2), "application/json");
    },
    downloadMarkdown: function () {
      download("signin-api-discovery-report.md", markdownForReport(), "text/markdown");
    }
  };

  installHooks();

  if (window[BOOTSTRAP_NAME]) {
    if (session.active && session.target === window[BOOTSTRAP_NAME].target) {
      collectStaticPageClues();
    } else {
      window[GLOBAL_NAME].start(window[BOOTSTRAP_NAME]);
    }
  }
})();
