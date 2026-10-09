#!/usr/bin/env node
// Downloads the task icons listed in public/js/icons.js as public/icons/<key>.png,
// skipping any that already have a .webp. The CDN serves them at 256px, so follow
// up with scripts/shrink-icons.py, which makes the 128px .webp the site uses.
//
//   node scripts/fetch-icons.mjs [--force]
//   python scripts/shrink-icons.py

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICONS, ICON_CDN } from '../public/js/icons.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'icons');
const force = process.argv.includes('--force');

await mkdir(outDir, { recursive: true });
for (const [key, { file }] of Object.entries(ICONS)) {
  if (existsSync(path.join(outDir, `${key}.webp`)) && !force) continue;
  const res = await fetch(ICON_CDN + file);
  if (!res.ok) {
    console.error(`${key}: ${file} answered ${res.status}`);
    process.exitCode = 1;
    continue;
  }
  await writeFile(path.join(outDir, `${key}.png`), Buffer.from(await res.arrayBuffer()));
  console.log(`${key} <- ${file}`);
}
