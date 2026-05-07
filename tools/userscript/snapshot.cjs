const path = require('path');
const { collectUserscriptState } = require('./runner.cjs');
const { ensureDir, timestampForPath, writeJson, writeText } = require('./artifacts.cjs');

function attachPageDiagnostics(page) {
  const consoleMessages = [];
  const pageErrors = [];

  page.on('console', (message) => {
    consoleMessages.push({
      type: message.type(),
      text: message.text(),
      location: message.location()
    });
  });

  page.on('pageerror', (error) => {
    pageErrors.push({
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  });

  return {
    consoleMessages,
    pageErrors
  };
}

async function savePageSnapshot(page, options) {
  const artifactDir = ensureDir(options.artifactDir);
  const consoleMessages = options.consoleMessages || [];
  const pageErrors = options.pageErrors || [];

  await page.screenshot({ path: path.join(artifactDir, 'screenshot.png'), fullPage: true });
  writeText(path.join(artifactDir, 'page.html'), await page.content());
  writeJson(path.join(artifactDir, 'console.json'), consoleMessages);
  writeJson(path.join(artifactDir, 'page-errors.json'), pageErrors);
  writeJson(path.join(artifactDir, 'userscript-state.json'), await collectUserscriptState(page));
  writeJson(path.join(artifactDir, 'summary.json'), {
    url: page.url(),
    title: await page.title().catch(() => ''),
    capturedAt: new Date().toISOString(),
    mode: options.mode,
    artifactDir,
    notes: options.notes || ''
  });

  return artifactDir;
}

function makeArtifactDir(repoRoot, kind, date = new Date()) {
  return path.join(repoRoot, 'artifacts', kind, timestampForPath(date));
}

module.exports = {
  attachPageDiagnostics,
  makeArtifactDir,
  savePageSnapshot
};

