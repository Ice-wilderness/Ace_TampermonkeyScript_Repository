import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const toolDir = dirname(fileURLToPath(import.meta.url));
const MAX_TEXT = 1600;
const MAX_ITEMS = 240;
const SENSITIVE_NAME_RE = /(cookie|authorization|passwd|password|token|csrf|xsrf|formhash|auth|secret|session|sessid|sid|email|e-mail|mail|username|user_name|account|phone|mobile|invite)/i;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node tools/signin-api-discovery/runner.mjs --url <url> [--target <name>]",
    "",
    "Options:",
    "  --url <url>              Target page to inspect.",
    "  --target <name>          Target label. Defaults to URL host.",
    "  --out <dir>              Report output directory.",
    "  --user-data-dir <dir>    Persistent Playwright profile directory.",
    "  --headless true          Run browser headless. Default: false."
  ].join("\n");
}

function safeSlug(value) {
  return String(value || "target")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "target";
}

function isoNow() {
  return new Date().toISOString();
}

function truncate(value, max = MAX_TEXT) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return text.slice(0, max) + "...[truncated " + (text.length - max) + " chars]";
}

function isSensitiveName(name) {
  return SENSITIVE_NAME_RE.test(String(name || ""));
}

function valueLength(value) {
  if (value == null) return 0;
  if (typeof value === "string") return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseJsonLike(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed || !/^[\[{]/.test(trimmed)) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

function redactPlainText(text) {
  return String(text || "")
    .replace(/(<[^>]+\bname=["']?(?:cookie|authorization|passwd|password|token|csrf|xsrf|formhash|auth|secret|session|sessid|sid|email|e-mail|mail|username|user_name|account|phone|mobile|invite)["']?[^>]*\bvalue=["'])([^"']*)/ig, "$1[REDACTED]")
    .replace(/((?:cookie|authorization)\s*[:=]\s*)([^;\n\r]+)/ig, "$1[REDACTED]")
    .replace(/((?:passwd|password|token|csrf|xsrf|formhash|auth|secret|session|sessid|sid|email|e-mail|mail|username|user_name|account|phone|mobile|invite)\w*\s*[:=]\s*)([^&\s"'<>]+)/ig, "$1[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig, "[REDACTED_EMAIL]");
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
    return value.slice(0, 80).map((item) => redactStructuredValue(item));
  }

  if (value && typeof value === "object") {
    const output = {};
    const keys = Object.keys(value);
    for (const name of keys.slice(0, 80)) {
      output[name] = redactStructuredValue(value[name], name);
    }
    if (keys.length > 80) output.__truncatedKeys = keys.length - 80;
    return output;
  }

  if (typeof value === "string") return redactPlainText(value);
  return value;
}

function redactText(text) {
  const raw = String(text ?? "");
  const parsed = parseJsonLike(raw);
  if (parsed.ok) return truncate(safeJson(redactStructuredValue(parsed.value)));
  return truncate(redactPlainText(raw));
}

function redactUrl(value) {
  const raw = String(value || "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    for (const name of Array.from(url.searchParams.keys())) {
      if (isSensitiveName(name)) url.searchParams.set(name, "[REDACTED]");
    }
    return url.href;
  } catch {
    return redactPlainText(raw);
  }
}

function summarizeValue(name, value) {
  const length = valueLength(value);
  if (isSensitiveName(name)) {
    return { redacted: true, reason: "sensitive-field", length };
  }
  if (value == null) return { value: "", length: 0 };
  return { value: redactText(String(value)), length };
}

function summarizeHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers || {})) {
    result[name] = isSensitiveName(name)
      ? { redacted: true, reason: "sensitive-header", length: valueLength(value) }
      : summarizeValue(name, value);
  }
  return result;
}

function summarizeBody(body) {
  if (body == null || body === "") return { type: "empty" };
  const text = String(body);
  if (/^\s*[\[{]/.test(text)) {
    return {
      type: "json",
      length: text.length,
      excerpt: redactText(text)
    };
  }
  if (/[=&]/.test(text)) {
    try {
      const params = new URLSearchParams(text);
      const entries = Array.from(params.entries());
      if (entries.length && entries.some(([name]) => name)) {
        const fields = {};
        for (const [name, value] of entries.slice(0, 80)) {
          fields[name] = summarizeValue(name, value);
        }
        return {
          type: "urlencoded-string",
          fieldCount: entries.length,
          fields,
          truncated: entries.length > 80
        };
      }
    } catch {
    }
  }

  return {
    type: "text",
    length: text.length,
    excerpt: redactText(text)
  };
}

function safeFrameUrl(request) {
  try {
    return redactUrl(request.frame().url());
  } catch {
    return "";
  }
}

function shouldReadResponseBody(request, response) {
  const type = request.resourceType();
  if (!["document", "fetch", "xhr"].includes(type)) return false;

  const headers = response.headers();
  const contentType = String(headers["content-type"] || "").toLowerCase();
  if (!contentType) return type !== "document";
  return /(json|text|xml|html|javascript|x-www-form-urlencoded)/i.test(contentType);
}

function createFallbackReport({ target, host, url, candidates }) {
  return {
    tool: "signin-api-discovery",
    version: "0.1.0",
    generatedAt: isoNow(),
    session: {
      target,
      host,
      url,
      pageUrl: url,
      note: "created by runner fallback",
      active: false,
      startedAt: "",
      stoppedAt: ""
    },
    networkCandidates: [],
    runnerNetworkCandidates: candidates,
    formSubmissions: [],
    actionCandidates: [],
    pageClues: {
      title: "",
      url,
      forms: [],
      buttons: [],
      tokenFields: [],
      alreadySignedText: []
    },
    implementationBoundary: {
      diagnosticOnly: true,
      writesSuccessStatus: false,
      modifiesSiteConfigs: false
    },
    uncertaintyNotes: [
      "Page injection report was unavailable; this report contains runner-level network evidence only."
    ]
  };
}

function markdownForRunnerReport(report) {
  const lines = [];
  lines.push("# Sign-in API Discovery Report");
  lines.push("");
  lines.push("- Target: " + (report.session.target || "(unspecified)"));
  lines.push("- Host: " + (report.session.host || "(unknown)"));
  lines.push("- Page: " + (report.session.pageUrl || report.session.url || "(unknown)"));
  lines.push("- Generated: " + report.generatedAt);
  lines.push("- Boundary: diagnostic evidence only; not a confirmed API.");

  lines.push("");
  lines.push("## Runner Network Candidates");
  if (!report.runnerNetworkCandidates.length) {
    lines.push("");
    lines.push("No runner network candidates captured.");
  } else {
    report.runnerNetworkCandidates.forEach((item, index) => {
      lines.push("");
      lines.push("### Runner Candidate " + (index + 1));
      lines.push("- Kind: " + item.kind);
      lines.push("- Method: " + item.request.method);
      lines.push("- URL: " + item.request.url);
      lines.push("- Resource: " + item.request.resourceType);
      lines.push("- Navigation: " + Boolean(item.request.isNavigationRequest));
      lines.push("- Status: " + (item.response && item.response.status !== undefined ? item.response.status : "(none)"));
      if (item.response && item.response.excerpt) {
        lines.push("- Response excerpt:");
        lines.push("");
        lines.push("```text");
        lines.push(item.response.excerpt);
        lines.push("```");
      }
      if (item.error) lines.push("- Error: " + item.error);
    });
  }

  return lines.join("\n");
}

function attachRunnerNetworkCapture(context, bootstrap) {
  const records = new Map();
  const candidates = [];
  const pending = new Set();

  function remember(record) {
    if (!record.__remembered) {
      record.__remembered = true;
      candidates.push(record);
      if (candidates.length > MAX_ITEMS) candidates.shift();
    }
  }

  context.on("request", (request) => {
    const record = {
      kind: "playwright-" + request.resourceType(),
      source: "playwright",
      label: "candidate",
      verified: false,
      needsFutureValidation: true,
      target: bootstrap.target,
      host: bootstrap.host,
      pageUrl: safeFrameUrl(request),
      startedAt: isoNow(),
      capturedAt: isoNow(),
      request: {
        method: request.method(),
        url: redactUrl(request.url()),
        resourceType: request.resourceType(),
        frameUrl: safeFrameUrl(request),
        isNavigationRequest: request.isNavigationRequest(),
        headers: summarizeHeaders(request.headers()),
        body: summarizeBody(request.postData())
      }
    };
    records.set(request, record);
    remember(record);
  });

  context.on("requestfailed", (request) => {
    const record = records.get(request);
    if (!record) return;
    record.capturedAt = isoNow();
    record.error = request.failure() && request.failure().errorText || "request failed";
  });

  context.on("response", (response) => {
    const request = response.request();
    const record = records.get(request);
    if (!record) return;

    record.capturedAt = isoNow();
    record.response = {
      status: response.status(),
      ok: response.ok(),
      url: redactUrl(response.url()),
      headers: summarizeHeaders(response.headers())
    };

    if (shouldReadResponseBody(request, response)) {
      const pendingRead = response.finished()
        .then(() => response.text())
        .then((text) => {
          record.response.excerpt = redactText(text);
        })
        .catch((error) => {
          record.response.excerpt = "[response body unavailable: " + (error && error.message ? error.message : String(error)) + "]";
        })
        .finally(() => pending.delete(pendingRead));
      pending.add(pendingRead);
    }
  });

  return {
    candidates,
    async flush() {
      await Promise.allSettled(Array.from(pending));
      candidates.forEach((record) => {
        delete record.__remembered;
      });
      return candidates;
    }
  };
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("Playwright is not available in this environment.");
    console.error("Use the manual injection flow in tools/signin-api-discovery/README.md, or install Playwright in your local dev environment.");
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const targetUrl = new URL(args.url);
  const target = args.target || targetUrl.host;
  const outDir = args.out || join(toolDir, "reports");
  const userDataDir = args["user-data-dir"] || join(toolDir, ".profile");
  const headless = args.headless === "true";

  const { chromium } = await loadPlaywright();
  const injectionSource = await readFile(join(toolDir, "inject.js"), "utf8");
  const bootstrap = {
    target,
    host: targetUrl.host,
    url: targetUrl.href,
    note: "started from signin-api-discovery runner"
  };

  await mkdir(outDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: null
  });
  const runnerCapture = attachRunnerNetworkCapture(context, bootstrap);
  await context.addInitScript({
    content: "window.__SIGNIN_API_DISCOVERY_BOOTSTRAP = " + JSON.stringify(bootstrap) + ";\n" + injectionSource
  });

  const page = await context.newPage();
  await page.goto(targetUrl.href, { waitUntil: "domcontentloaded" });

  console.log("Discovery active for:", targetUrl.href);
  console.log("Interact with the page, trigger sign-in or related actions, then return here.");

  const rl = createInterface({ input, output });
  await rl.question("Press Enter to export the diagnostic report...");
  rl.close();

  const runnerNetworkCandidates = await runnerCapture.flush();
  let report = null;
  try {
    report = await page.evaluate(() => window.__signinApiDiscovery && window.__signinApiDiscovery.report());
  } catch {}
  if (!report) {
    report = createFallbackReport({
      target,
      host: targetUrl.host,
      url: targetUrl.href,
      candidates: runnerNetworkCandidates
    });
  } else {
    report.runnerNetworkCandidates = runnerNetworkCandidates;
  }

  let markdown = "";
  try {
    markdown = await page.evaluate((snapshot) => window.__signinApiDiscovery.toMarkdown(snapshot), report);
  } catch {
    markdown = markdownForRunnerReport(report);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = safeSlug(target) + "-" + stamp;

  const jsonPath = join(outDir, base + ".json");
  const markdownPath = join(outDir, base + ".md");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await writeFile(markdownPath, markdown, "utf8");

  console.log("Wrote:", jsonPath);
  console.log("Wrote:", markdownPath);

  await context.close();
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
