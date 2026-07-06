// MCP server launcher — picks the right way to run the server for where this
// package is sitting. `.mcp.json` (and gemini-extension.json) point here.
//
// Two situations share one manifest:
// - Development checkout (Studio workspace or the standalone repo):
//   node_modules are resolvable, and the server must run from src/ via tsx so
//   edits take effect without any build step.
// - Installed plugin (~/.claude/plugins/cache/...): the installer copies this
//   package from git verbatim — no node_modules, no build hooks — so the only
//   runnable form is the self-contained esbuild bundle that CI builds and
//   publishes on the `plugin-dist` branch (see scripts/build-mcp-bundle.mjs
//   and .github/workflows/publish-plugin-dist.yml).
//
// Detection: dev mode requires BOTH tsx and a real dependency to resolve from
// the package root (two checks so a stray ~/node_modules can't fake it).
// Source is preferred over the bundle so a dev checkout never runs a stale
// dist by accident.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcEntry = join(pkgRoot, 'src', 'mcp-server.ts');
const bundle = join(pkgRoot, 'dist', 'mcp-server.bundle.mjs');

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
  const child = spawn(process.execPath, [tsxCli, srcEntry], {
    cwd: pkgRoot,
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
  child.on('error', (err) => {
    console.error(`[data-liberation] failed to start tsx: ${err.message}`);
    process.exit(1);
  });
} else if (existsSync(bundle)) {
  await import(pathToFileURL(bundle).href);
} else {
  console.error(
    '[data-liberation] Cannot start the MCP server: no resolvable dependencies for src/ and no dist/mcp-server.bundle.mjs.\n' +
      'In a development checkout, run `npm install` first.\n' +
      'As a plugin, install from the published marketplace (the `plugin-dist` branch), which ships the prebuilt bundle — ' +
      'or build one locally with `npm run build:mcp-bundle`.'
  );
  process.exit(1);
}
