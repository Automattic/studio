// Driver-script launcher — the scripts/*.ts counterpart of mcp-launcher.mjs.
// Skills invoke pipeline drivers as `node scripts/run.mjs <name> [args...]`
// instead of `npx tsx scripts/<name>.ts [args...]`, so the same instruction
// works in both places a skill can run:
//
// - Development checkout: node_modules resolve, so the driver runs from
//   scripts/<name>.ts via tsx and edits take effect immediately.
// - Installed plugin (~/.claude/plugins/cache/...): the installer copies this
//   package verbatim — no node_modules — so the only runnable form is the
//   committed self-contained bundle at dist/scripts/<name>.mjs (built by
//   scripts/build-mcp-bundle.mjs alongside the MCP server bundle).
//
// Detection mirrors mcp-launcher.mjs: dev mode requires BOTH tsx and a real
// dependency to resolve from the package root, and source is preferred over
// the bundle so a dev checkout never runs a stale dist.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = join(pkgRoot, 'dist', 'scripts');

const name = process.argv[2];
if (!name || !/^[a-z0-9_-]+$/i.test(name)) {
  console.error(`Usage: node scripts/run.mjs <script-name> [args...]\n\n${available()}`);
  process.exit(1);
}

const srcEntry = join(pkgRoot, 'scripts', `${name}.ts`);
const bundle = join(bundleDir, `${name}.mjs`);

function available() {
  const names = new Set();
  // Without resolvable dev deps only the committed bundles can run — don't
  // advertise source-only scripts the caller would just fail on.
  const dirs = [[bundleDir, '.mjs']];
  if (resolveDevTsx()) dirs.push([join(pkgRoot, 'scripts'), '.ts']);
  for (const [dir, ext] of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.endsWith(ext) && !f.startsWith('chunk-')) names.add(basename(f, ext));
    }
  }
  return names.size ? `Available scripts: ${[...names].sort().join(', ')}` : '';
}

function resolveDevTsx() {
  try {
    const req = createRequire(join(pkgRoot, 'package.json'));
    req.resolve('@modelcontextprotocol/sdk/package.json');
    return req.resolve('tsx/cli');
  } catch {
    return null;
  }
}

const tsxCli = existsSync(srcEntry) ? resolveDevTsx() : null;

if (tsxCli) {
  const child = spawn(process.execPath, [tsxCli, srcEntry, ...process.argv.slice(3)], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
  child.on('error', (err) => {
    console.error(`[data-liberation] failed to start tsx: ${err.message}`);
    process.exit(1);
  });
} else if (existsSync(bundle)) {
  // Run in-process so the driver sees the argv shape tsx would give it:
  // process.argv[2..] = its own args. Drop this launcher's <name> slot.
  process.argv.splice(2, 1);
  try {
    await import(pathToFileURL(bundle).href);
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && /'(playwright|single-file-cli)'/.test(err.message)) {
      console.error(
        `[data-liberation] ${name} needs a dependency that cannot ship inside the bundle: ${err.message}\n` +
          `Install it next to the plugin: cd "${pkgRoot}" && npm install playwright && npx playwright install chromium`
      );
      process.exit(1);
    }
    throw err;
  }
} else {
  console.error(
    `[data-liberation] Cannot run "${name}": no resolvable dependencies for scripts/${name}.ts and no dist/scripts/${name}.mjs.\n` +
      'In a development checkout, run `npm install` first.\n' +
      'As a plugin, install from the published marketplace, which ships the prebuilt bundles — ' +
      `or build them locally with \`npm run build:mcp-bundle\`.\n\n${available()}`
  );
  process.exit(1);
}
