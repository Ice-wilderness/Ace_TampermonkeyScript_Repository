import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const file of ['test.mjs', 'state-execution.test.mjs', 'request-storage.test.mjs', 'browser.test.mjs']) {
    execFileSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], { stdio: 'inherit', env: { ...process.env, TZ: 'Asia/Shanghai' } });
}
