const path = require('path');
const { pathToFileURL } = require('url');
const { readUserscriptMetadata } = require('./metadata.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'Bilibili视频观看历史记录.js');
const metadata = readUserscriptMetadata(scriptPath);
const fileUrl = pathToFileURL(scriptPath).href;

const headerLines = [
  '// ==UserScript==',
  `// @name         ${metadata.name} Dev Loader`,
  `// @namespace    ${metadata.namespace}.dev-loader`,
  `// @version      ${metadata.version}`,
  `// @description  本地开发加载器：通过 @require 加载仓库中的 ${path.basename(scriptPath)}`,
  '// @author       Local',
  ...metadata.matches.map((value) => `// @match        ${value}`),
  ...metadata.includes.map((value) => `// @include      ${value}`),
  ...metadata.grants.map((value) => `// @grant        ${value}`),
  `// @run-at       ${metadata.runAt}`,
  `// @require      ${fileUrl}`,
  '// ==/UserScript=='
];

console.log(headerLines.join('\n'));
console.log('\n// 将以上内容保存为 Tampermonkey 脚本；之后刷新匹配页面即可加载仓库里的最新文件。');
