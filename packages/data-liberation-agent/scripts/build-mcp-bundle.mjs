// Bundle the MCP server (dist/mcp-server.bundle.mjs) and the skill-invoked
// driver scripts (dist/scripts/<name>.mjs) into self-contained artifacts.
//
// Why: the Claude/Codex plugin installer copies this package's files into
// ~/.claude/plugins/cache/... WITHOUT node_modules — and inside the Studio npm
// workspace the dependencies are hoisted to the repo root anyway — so a
// `npx tsx src/mcp-server.ts` entry has nothing to import once installed as a
// plugin. The bundles inline every dependency so `.mcp.json` can point a bare
// `node` at the server bundle and `scripts/run.mjs` can run the drivers. The
// committed bundles are the plugin's distribution artifacts; regenerate them
// (npm run build:mcp-bundle) whenever src/, scripts/, or dependencies change.
//
// Exceptions that stay external (resolved at runtime, degrade gracefully):
// - playwright: browser driver + downloaded browsers can't live in a bundle.
//   The server only loads it via guarded dynamic import (see lib/browser-kit);
//   drivers that import it statically fail fast and scripts/run.mjs turns that
//   into install guidance.
// - single-file-cli: optional page-freeze asset, loaded lazily and only useful
//   when playwright is present.
//
// One seam needs build-time help: modules resolve runtime assets (vendored
// PHP helpers, core-block-attrs.json, the block-fixer sidecar) relative to
// their own import.meta.url, and those per-module paths conflict once
// everything shares a bundle's URL. The plugin below rewrites import.meta.url
// in OUR modules to point back at the original source file, relative to the
// bundle location — the src/ tree (including its .php and .json assets) ships
// with the plugin, so the lookups keep working.
import { build } from 'esbuild';
import { relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, rm } from 'node:fs/promises';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(pkgRoot, 'src');
const scriptsDir = resolve(pkgRoot, 'scripts');
const serverOutfile = resolve(pkgRoot, 'dist', 'mcp-server.bundle.mjs');
const scriptsOutDir = resolve(pkgRoot, 'dist', 'scripts');

// Every driver a shipped skill invokes through scripts/run.mjs. Adding a
// `node scripts/run.mjs <name>` step to a SKILL.md means adding <name> here,
// or the step only works in dev checkouts.
const SKILL_DRIVERS = [
  '_shot',
  '_validate',
  'carry-chrome-audit-run',
  'carry-reconstruct-drive',
  'carry-replica-shots',
  'enrich-product-marketing',
  'localize-native-post-media',
  'triage-candidates',
];

/** Rewrite import.meta.url in first-party modules to the original file's URL,
 * expressed relative to the bundle so it survives being copied anywhere. */
function perModuleImportMetaUrl(outDir) {
  return {
    name: 'per-module-import-meta-url',
    setup(pluginBuild) {
      pluginBuild.onLoad({ filter: /\.(ts|tsx)$/ }, async (args) => {
        if (!args.path.startsWith(srcDir) && !args.path.startsWith(scriptsDir)) return undefined;
        const source = await readFile(args.path, 'utf8');
        if (!source.includes('import.meta.url')) return undefined;
        const relFromBundle = relative(outDir, args.path).split('\\').join('/');
        const replacement = `new URL(${JSON.stringify(relFromBundle)}, import.meta.url).href`;
        return {
          contents: source.replaceAll('import.meta.url', replacement),
          loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
        };
      });
    },
  };
}

const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  sourcemap: false,
  metafile: true,
  logLevel: 'info',
  external: ['playwright', 'single-file-cli'],
  // Bundled CJS dependencies may call require() at runtime; ESM output has
  // no ambient require, so provide one anchored to the bundle.
  banner: {
    js: [
      "import { createRequire as __bundleCreateRequire } from 'node:module';",
      'const require = __bundleCreateRequire(import.meta.url);',
    ].join('\n'),
  },
};

const server = await build({
  ...shared,
  entryPoints: [resolve(srcDir, 'mcp-server.ts')],
  outfile: serverOutfile,
  plugins: [perModuleImportMetaUrl(dirname(serverOutfile))],
});

// Clean first so renamed entry points and stale shared chunks don't linger —
// the committed dist/scripts/ must be exactly what this build emits.
await rm(scriptsOutDir, { recursive: true, force: true });
const drivers = await build({
  ...shared,
  entryPoints: SKILL_DRIVERS.map((name) => resolve(scriptsDir, `${name}.ts`)),
  outdir: scriptsOutDir,
  outExtension: { '.js': '.mjs' },
  splitting: true,
  chunkNames: 'chunk-[hash]',
  plugins: [perModuleImportMetaUrl(scriptsOutDir)],
});

// The block-fixer sidecar is NOT bundled: registerCoreBlocks drags the whole
// @wordpress/block-library + block-editor React tree in (~92 MB minified) —
// far too large to commit. Instead the sidecar ships its own committed
// package-lock.json and block-fixer-client restores the nested install at
// first use (`npm ci --ignore-scripts`) when the deps don't resolve. The
// deps must stay nested — hoisting them into this package's tree would put
// React 18 next to Ink's React 19, the exact conflict the sidecar isolates.

for (const [result, label] of [
  [server, relative(pkgRoot, serverOutfile)],
  [drivers, `${relative(pkgRoot, scriptsOutDir)}/ (${SKILL_DRIVERS.length} drivers)`],
]) {
  const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
  process.stdout.write(`build-mcp-bundle: wrote ${label} (${(bytes / 1024 / 1024).toFixed(1)} MB)\n`);
}
