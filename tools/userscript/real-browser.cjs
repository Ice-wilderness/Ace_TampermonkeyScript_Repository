const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function findBrowserExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }

  const absoluteCandidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];

  for (const candidate of absoluteCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  for (const command of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  }

  return null;
}

function buildChromeArgs(options) {
  const args = [
    `--user-data-dir=${options.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check'
  ];

  if (options.remoteDebuggingPort !== undefined && options.remoteDebuggingPort !== null) {
    args.push(`--remote-debugging-port=${options.remoteDebuggingPort}`);
    args.push('--remote-debugging-address=127.0.0.1');
    args.push('--remote-allow-origins=*');
  }

  if (options.startUrl) {
    args.push(options.startUrl);
  }

  return args;
}

function devToolsActivePortPath(profileDir) {
  return path.join(profileDir, 'DevToolsActivePort');
}

function clearDevToolsActivePort(profileDir) {
  const filePath = devToolsActivePortPath(profileDir);
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDevToolsEndpoint(profileDir, options = {}) {
  const timeoutMs = options.timeoutMs || 10_000;
  const startedAt = Date.now();
  const filePath = devToolsActivePortPath(profileDir);

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      const [portLine, browserPathLine] = content.split(/\r?\n/);
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0) {
        return {
          port,
          httpEndpoint: `http://127.0.0.1:${port}`,
          wsEndpoint: browserPathLine ? `ws://127.0.0.1:${port}${browserPathLine}` : null,
          filePath
        };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    await sleep(100);
  }

  throw new Error([
    `Chrome 没有在 ${timeoutMs}ms 内写入 DevTools endpoint: ${filePath}`,
    '请确认没有其他 Chrome 窗口正在使用同一个 .browser-profiles/bilibili-real/ profile，然后重试。'
  ].join('\n'));
}

function launchChrome(options) {
  const browserPath = findBrowserExecutable();
  if (!browserPath) {
    throw new Error('未找到可用的 Chrome/Chromium。请先在 WSL 中安装 google-chrome-stable，或设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH。');
  }

  const args = buildChromeArgs(options);
  const process = spawn(browserPath, args, {
    stdio: options.stdio || 'inherit'
  });

  return {
    browserPath,
    args,
    process
  };
}

function findFreePort(startPort = 9222) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          tryPort(port + 1);
          return;
        }
        reject(error);
      });
      server.once('listening', () => {
        server.close(() => resolve(port));
      });
      server.listen(port, '127.0.0.1');
    };

    tryPort(startPort);
  });
}

module.exports = {
  buildChromeArgs,
  clearDevToolsActivePort,
  devToolsActivePortPath,
  findBrowserExecutable,
  findFreePort,
  launchChrome,
  waitForDevToolsEndpoint
};
