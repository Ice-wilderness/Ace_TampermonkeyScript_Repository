const path = require('path');
const { buildUrlMatcherRegexps, readUserscriptMetadata } = require('./metadata.cjs');

function toJsonForInit(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildGmShimSource({ metadata, initialStore = {}, eagerIntersectionObserver = false }) {
  const scriptInfo = {
    name: metadata.name,
    namespace: metadata.namespace,
    version: metadata.version,
    description: metadata.description,
    author: metadata.author,
    matches: metadata.matches,
    includes: metadata.includes,
    grants: metadata.grants,
    runAt: metadata.runAt
  };

  return `
(() => {
  const clone = (value) => {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  };

  const initialStore = ${toJsonForInit(initialStore)};
  const store = window.__userscriptGMStore || Object.create(null);
  Object.keys(initialStore).forEach((key) => {
    if (!(key in store)) store[key] = clone(initialStore[key]);
  });
  window.__userscriptGMStore = store;

  const menuCommands = [];
  const menuHandlers = new Map();

  Object.defineProperty(window, 'unsafeWindow', {
    configurable: true,
    value: window
  });

  Object.defineProperty(window, 'GM_info', {
    configurable: true,
    value: {
      script: ${toJsonForInit(scriptInfo)},
      scriptHandler: 'Playwright userscript runner',
      version: '0.1.0'
    }
  });

  Object.defineProperty(window, 'GM_getValue', {
    configurable: true,
    value(key, defaultValue) {
      return Object.prototype.hasOwnProperty.call(store, key) ? clone(store[key]) : defaultValue;
    }
  });

  Object.defineProperty(window, 'GM_setValue', {
    configurable: true,
    value(key, value) {
      store[key] = clone(value);
    }
  });

  Object.defineProperty(window, 'GM_deleteValue', {
    configurable: true,
    value(key) {
      delete store[key];
    }
  });

  Object.defineProperty(window, 'GM_listValues', {
    configurable: true,
    value() {
      return Object.keys(store);
    }
  });

  Object.defineProperty(window, 'GM_addStyle', {
    configurable: true,
    value(css) {
      const style = document.createElement('style');
      style.textContent = String(css || '');
      (document.head || document.documentElement).appendChild(style);
      return style;
    }
  });

  Object.defineProperty(window, 'GM_registerMenuCommand', {
    configurable: true,
    value(name, handler) {
      const id = menuCommands.length + 1;
      menuCommands.push({ id, name });
      menuHandlers.set(String(id), handler);
      menuHandlers.set(name, handler);
      return id;
    }
  });

  Object.defineProperty(window, '__userscriptGetGMStore', {
    configurable: true,
    value() {
      return clone(store);
    }
  });

  Object.defineProperty(window, '__userscriptGetMenuCommands', {
    configurable: true,
    value() {
      return clone(menuCommands);
    }
  });

  Object.defineProperty(window, '__userscriptRunMenuCommand', {
    configurable: true,
    value(idOrName) {
      const handler = menuHandlers.get(String(idOrName)) || menuHandlers.get(idOrName);
      if (!handler) throw new Error('Menu command not found: ' + idOrName);
      return handler();
    }
  });

  if (${eagerIntersectionObserver ? 'true' : 'false'}) {
    class EagerIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
        this.targets = new Set();
      }

      observe(target) {
        this.targets.add(target);
        setTimeout(() => {
          if (!this.targets.has(target)) return;
          this.callback([{
            target,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRect: target.getBoundingClientRect(),
            rootBounds: null,
            time: performance.now()
          }], this);
        }, 0);
      }

      unobserve(target) {
        this.targets.delete(target);
      }

      disconnect() {
        this.targets.clear();
      }

      takeRecords() {
        return [];
      }
    }

    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: EagerIntersectionObserver
    });
  }
})();
`;
}

function buildUserscriptWrapperSource({ scriptPath, metadata }) {
  const regexps = buildUrlMatcherRegexps(metadata).map((regexp) => regexp.source);
  const regexpsJson = toJsonForInit(regexps);
  const source = metadata.source;
  const label = path.basename(scriptPath);

  return `
(() => {
  const patterns = ${regexpsJson}.map((source) => new RegExp(source));
  if (!patterns.some((regexp) => regexp.test(location.href))) return;
  try {
${source}
  } catch (error) {
    console.error('[userscript-runner] ${label} failed', error);
    throw error;
  }
})();
//# sourceURL=${label}
`;
}

async function installUserscript(context, options) {
  const scriptPath = path.resolve(options.scriptPath);
  const metadata = readUserscriptMetadata(scriptPath);

  await context.addInitScript({
    content: buildGmShimSource({
      metadata,
      initialStore: options.initialStore || {},
      eagerIntersectionObserver: !!options.eagerIntersectionObserver
    })
  });

  await context.addInitScript({
    content: buildUserscriptWrapperSource({ scriptPath, metadata })
  });

  return metadata;
}

async function collectUserscriptState(page) {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title,
    gmStore: typeof window.__userscriptGetGMStore === 'function' ? window.__userscriptGetGMStore() : null,
    menuCommands: typeof window.__userscriptGetMenuCommands === 'function' ? window.__userscriptGetMenuCommands() : []
  }));
}

module.exports = {
  installUserscript,
  collectUserscriptState
};

