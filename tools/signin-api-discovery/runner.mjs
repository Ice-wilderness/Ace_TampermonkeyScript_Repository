import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const toolDir = dirname(fileURLToPath(import.meta.url));

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

  const report = await page.evaluate(() => window.__signinApiDiscovery.report());
  const markdown = await page.evaluate((snapshot) => window.__signinApiDiscovery.toMarkdown(snapshot), report);
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
