import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

for (const directory of ['unb-now', 'scripts', 'tests']) {
  for (const file of await readdir(new URL(`../${directory}/`, import.meta.url), { recursive: true })) {
    if (!/\.(m?js)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', `${directory}/${file}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
process.stdout.write('All JavaScript syntax checks passed.\n');
