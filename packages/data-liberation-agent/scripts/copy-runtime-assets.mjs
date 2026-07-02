// Copy non-TypeScript runtime assets that tsc does not emit into dist/.
//
// tsc only compiles .ts → .js, so vendored PHP helpers under
// src/lib/**/scripts/*.php (run inside the WP site via `wp eval-file`) never
// reach dist/. When the MCP server runs from the compiled build, code paths
// like installMediaForUrl resolve `<thisModuleDir>/../preview/scripts/install-media.php`
// relative to dist/ and fail with ENOENT. Mirror the src/ tree into dist/ for
// every runtime asset glob below so the compiled server behaves like tsx.
import { readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(repoRoot, 'src');
const DIST = join(repoRoot, 'dist');

// Extensions of runtime (non-test, non-fixture) assets to mirror into dist/.
const RUNTIME_EXT = /\.php$/;
// Directories never copied (test fixtures / snapshots are not runtime).
const SKIP_DIR = /(^|\/)(__fixtures__|__snapshots__)(\/|$)/;

let copied = 0;
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = relative(SRC, abs);
    if (SKIP_DIR.test(rel.replace(/\\/g, '/'))) continue;
    if (statSync(abs).isDirectory()) {
      walk(abs);
      continue;
    }
    if (!RUNTIME_EXT.test(entry)) continue;
    const dest = join(DIST, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(abs, dest);
    copied += 1;
  }
}

walk(SRC);
process.stdout.write(`copy-runtime-assets: copied ${copied} file(s) into dist/\n`);
