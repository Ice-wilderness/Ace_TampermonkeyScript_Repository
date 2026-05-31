import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const toolDir = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(toolDir, "inject.js"), "utf8");
const listeners = new Map();

function addListener(type, handler) {
  const bucket = listeners.get(type) || [];
  bucket.push(handler);
  listeners.set(type, bucket);
}

function element(tag, props = {}) {
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    parentElement: props.parentElement || null,
    id: props.id || "",
    className: props.className || "",
    type: props.type || "",
    name: props.name || "",
    value: props.value || "",
    innerText: props.innerText || "",
    textContent: props.textContent || props.innerText || "",
    href: props.href || "",
    action: props.action || "",
    method: props.method || "",
    getAttribute(name) {
      return props.attrs && props.attrs[name] || "";
    },
    closest() {
      return this;
    },
    querySelectorAll(selector) {
      if (selector === "input, textarea, select") return props.fields || [];
      return [];
    }
  };
}

const passwordField = element("input", { type: "password", name: "password", value: "rawpass" });
const tokenField = element("input", { type: "hidden", name: "formhash", value: "abc123" });
const messageField = element("textarea", { name: "message", value: "hello" });
const signButton = element("button", { innerText: "签到" });
const form = element("form", {
  id: "sign-form",
  action: "https://example.test/plugin.php?id=sign",
  method: "post",
  fields: [passwordField, tokenField, messageField]
});

class FakeFormData {
  constructor(targetForm) {
    this.entriesList = (targetForm.querySelectorAll("input, textarea, select") || [])
      .map((field) => [field.name, field.value]);
  }
  entries() {
    return this.entriesList[Symbol.iterator]();
  }
  [Symbol.iterator]() {
    return this.entries();
  }
}

class FakeXHR {
  constructor() {
    this.headers = {};
    this.status = 200;
    this.responseText = "already signed authorization: raw-xhr-secret";
    this.responseType = "";
    this.callbacks = {};
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name, value) {
    this.headers[name] = value;
  }
  addEventListener(type, callback) {
    this.callbacks[type] = callback;
  }
  send() {
    if (this.callbacks.loadend) this.callbacks.loadend();
  }
}

const context = {
  console,
  URL,
  Blob,
  FormData: FakeFormData,
  XMLHttpRequest: FakeXHR,
  Request: class {},
  Headers: class {},
  navigator: {},
  location: new URL("https://example.test/checkin"),
  document: {
    title: "Example sign page",
    body: {
      innerText: "今日已签到\n欢迎回来"
    },
    addEventListener: addListener,
    querySelectorAll(selector) {
      if (selector === "form") return [form];
      if (selector.includes("button")) return [signButton];
      if (selector.includes("hidden") || selector.includes("meta")) return [tokenField];
      return [];
    },
    createElement() {
      return element("a");
    }
  },
  fetch: async function fakeFetch(url, init) {
    return {
      status: 200,
      ok: true,
      url: String(url),
      clone() {
        return {
          text: async () => "签到成功 token=raw-fetch-secret"
        };
      }
    };
  },
  setTimeout
};
context.window = context;

vm.runInNewContext(source, context, { filename: "inject.js" });

const api = context.window.__signinApiDiscovery;
assert.ok(api);
api.start({ target: "example", host: "example.test" });

await context.fetch("/api/sign", {
  method: "POST",
  headers: {
    Authorization: "Bearer raw-auth-secret"
  },
  body: "formhash=abc123&password=rawpass&message=hello"
});

const xhr = new context.XMLHttpRequest();
xhr.open("POST", "/ajax/sign");
xhr.setRequestHeader("Cookie", "sid=rawcookie");
xhr.send("token=raw-xhr-token&message=hello");

for (const handler of listeners.get("submit") || []) {
  handler({ target: form, submitter: signButton });
}

const report = api.report();
const text = JSON.stringify(report);

assert.equal(report.networkCandidates.length, 2);
assert.equal(report.formSubmissions.length, 1);
assert.ok(report.pageClues.buttons.length >= 1);
assert.ok(report.pageClues.alreadySignedText.length >= 1);
assert.match(text, /candidate/);
assert.match(text, /needsFutureValidation/);
assert.doesNotMatch(text, /raw-auth-secret/);
assert.doesNotMatch(text, /rawcookie/);
assert.doesNotMatch(text, /rawpass/);
assert.doesNotMatch(text, /abc123/);
assert.doesNotMatch(text, /raw-fetch-secret/);
assert.doesNotMatch(text, /raw-xhr-secret/);

console.log("signin-api-discovery tests passed");
