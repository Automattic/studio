// Bundle the MCP server into a single self-contained dist/mcp-server.bundle.mjs.
//
// Why: the Claude/Codex plugin installer copies this package's files into
// ~/.claude/plugins/cache/... WITHOUT node_modules — and inside the Studio npm
// workspace the dependencies are hoisted to the repo root anyway — so a
// `npx tsx src/mcp-server.ts` entry has nothing to import once installed as a
// plugin. The bundle inlines every dependency so `.mcp.json` can point a bare
// `node` at it. The committed bundle is the plugin's distribution artifact;
// regenerate it (npm run build:mcp-bundle) whenever src/ or dependencies
// change.
//
// Exceptions that stay external (resolved at runtime, degrade gracefully):
// - playwright: browser driver + downloaded browsers can't live in a bundle.
//   Only ever loaded via guarded dynamic import (see lib/browser-kit), which
//   already reports install guidance when missing.
// - single-file-cli: optional page-freeze asset, loaded lazily and only useful
//   when playwright is present.
//
// One seam needs build-time help: modules resolve runtime assets (vendored
// PHP helpers, core-block-attrs.json, the block-fixer sidecar) relative to
// their own import.meta.url, and those per-module paths conflict once
// everything shares the bundle's URL. The plugin below rewrites
// import.meta.url in OUR src modules to point back at the original source
// file, relative to the bundle location — the src/ tree (including its .php
// and .json assets) ships with the plugin, so the lookups keep working.
import { build } from 'esbuild';
import { relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(pkgRoot, 'src');
const outfile = resolve(pkgRoot, 'dist', 'mcp-server.bundle.mjs');
const outDir = dirname(outfile);

/** Rewrite import.meta.url in first-party modules to the original file's URL,
 * expressed relative to the bundle so it survives being copied anywhere. */
const perModuleImportMetaUrl = {
  name: 'per-module-import-meta-url',
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /\.(ts|tsx)$/ }, async (args) => {
      if (!args.path.startsWith(srcDir)) return undefined;
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

const result = await build({
  entryPoints: [resolve(srcDir, 'mcp-server.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  sourcemap: false,
  metafile: true,
  logLevel: 'info',
  external: ['playwright', 'single-file-cli'],
  plugins: [perModuleImportMetaUrl],
  // Bundled CJS dependencies may call require() at runtime; ESM output has
  // no ambient require, so provide one anchored to the bundle.
  banner: {
    js: [
      "import { createRequire as __bundleCreateRequire } from 'node:module';",
      'const require = __bundleCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});

const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
process.stdout.write(
  `build-mcp-bundle: wrote ${relative(pkgRoot, outfile)} (${(bytes / 1024 / 1024).toFixed(1)} MB)\n`
);
