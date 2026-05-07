const fs = require('fs');

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.*]/g, '\\$&');
}

function globToRegExpSource(value) {
  return escapeRegExp(value).replace(/\\\*/g, '.*');
}

function readUserscriptMetadata(scriptPath) {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const block = source.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);

  if (!block) {
    throw new Error(`Userscript metadata block not found: ${scriptPath}`);
  }

  const entries = [];
  const values = {};

  block[1].split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*\/\/\s*@(\S+)\s*(.*)$/);
    if (!match) return;

    const key = match[1];
    const value = match[2].trim();
    entries.push({ key, value });

    if (!values[key]) values[key] = [];
    values[key].push(value);
  });

  return {
    source,
    entries,
    values,
    name: values.name?.[0] || '',
    namespace: values.namespace?.[0] || '',
    version: values.version?.[0] || '',
    description: values.description?.[0] || '',
    author: values.author?.[0] || '',
    runAt: values['run-at']?.[0] || 'document-end',
    matches: values.match || [],
    includes: values.include || [],
    grants: values.grant || []
  };
}

function matchPatternToRegExp(pattern) {
  const match = String(pattern).match(/^(\*|https?|file):\/\/([^/]*)(\/.*)?$/);
  if (!match) {
    throw new Error(`Unsupported userscript @match pattern: ${pattern}`);
  }

  const [, scheme, host, rawPath] = match;
  const schemeSource = scheme === '*' ? 'https?' : escapeRegExp(scheme);

  let hostSource;
  if (host === '*') {
    hostSource = '[^/?#]*';
  } else if (host.startsWith('*.')) {
    hostSource = `(?:[^/?#.]+\\.)*${escapeRegExp(host.slice(2))}`;
  } else {
    hostSource = globToRegExpSource(host);
  }

  const pathSource = rawPath ? globToRegExpSource(rawPath) : '/?';
  return new RegExp(`^${schemeSource}:\\/\\/${hostSource}${pathSource}(?:#.*)?$`);
}

function includePatternToRegExp(pattern) {
  return new RegExp(`^${globToRegExpSource(pattern)}$`);
}

function buildUrlMatcherRegexps(metadata) {
  const regexps = metadata.matches.map(matchPatternToRegExp);
  metadata.includes.forEach((pattern) => regexps.push(includePatternToRegExp(pattern)));
  return regexps;
}

function userscriptMatchesUrl(metadata, url) {
  return buildUrlMatcherRegexps(metadata).some((regexp) => regexp.test(url));
}

module.exports = {
  readUserscriptMetadata,
  matchPatternToRegExp,
  buildUrlMatcherRegexps,
  userscriptMatchesUrl
};
