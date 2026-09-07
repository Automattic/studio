import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'data-liberation-package-'));
const consumerDir = join(scratch, 'consumer');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const COMMAND_TIMEOUT_MS = 180_000;
const MCP_TIMEOUT_MS = 30_000;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: COMMAND_TIMEOUT_MS,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return result;
}

async function withDeadline(promise, label, timeoutMs = MCP_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

try {
  mkdirSync(consumerDir);
  const packed = run(npm, ['pack', '--json', '--pack-destination', scratch]);
  const [{ filename }] = JSON.parse(packed.stdout);
  run(npm, [
    'install',
    '--prefix', consumerDir,
    join(scratch, filename),
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ]);

  const packageRoot = join(consumerDir, 'node_modules', 'data-liberation');
  const cli = run(process.execPath, [join(packageRoot, 'dist', 'cli.js'), '--help']);
  if (!cli.stdout.includes('data-liberation')) {
    throw new Error('Installed CLI did not print Data Liberation help.');
  }

  const captureEngine = await import(
    pathToFileURL(join(packageRoot, 'dist', 'capture-engine.bundle.mjs')).href
  );
  if (typeof captureEngine.captureWebsite !== 'function') {
    throw new Error('Installed capture engine does not export captureWebsite.');
  }

  // Public Platform API — an installed consumer registers a custom platform,
  // which must auto-detect through the package entry WITHOUT touching core,
  // and the built-ins must register through the same seam.
  writeFileSync(
    join(consumerDir, 'platform-consumer.mjs'),
    [
      "import { registerPlatform, detectPlatform, registeredPlatforms } from 'data-liberation';",
      "registerPlatform({",
      "  id: 'acme-builder',",
      "  detection: { urlPatterns: [/acme-builder\\.example/i] },",
      "  discover: async (url) => ({ urls: [{ url, type: 'homepage' }] }),",
      "  liberation: { removeSelectors: ['.acme-cookie-banner'] },",
      "});",
      "const detection = await detectPlatform('https://blog.acme-builder.example/');",
      "if (detection.platform !== 'acme-builder' || detection.confidence !== 'high') {",
      "  throw new Error('Custom platform did not auto-detect: ' + JSON.stringify(detection));",
      "}",
      "const ids = registeredPlatforms().map((p) => p.id);",
      "if (!ids.includes('wix') || !ids.includes('default') || !ids.includes('acme-builder')) {",
      "  throw new Error('Registry missing expected platforms: ' + ids.join(', '));",
      "}",
      "console.log('consumer platform registered, detected, and resolvable');",
    ].join('\n'),
  );
  const consumer = run(process.execPath, ['platform-consumer.mjs'], { cwd: consumerDir });
  if (!consumer.stdout.includes('consumer platform registered')) {
    throw new Error('Installed-package platform consumer check failed.');
  }

  for (const relativePath of [
    'scripts/run.mjs',
    'skills/liberate/SKILL.md',
  ]) {
    if (!existsSync(join(packageRoot, relativePath))) {
      throw new Error(`Installed package is missing ${relativePath}.`);
    }
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(packageRoot, 'dist', 'mcp-server.bundle.mjs')],
    cwd: packageRoot,
    stderr: 'inherit',
  });
  const client = new Client({ name: 'package-smoke', version: '1.0.0' }, { capabilities: {} });
  try {
    await withDeadline(client.connect(transport), 'Installed MCP server connection');
    const tools = await withDeadline(client.listTools(), 'Installed MCP server tool listing');
    const offered = tools.tools.map((tool) => tool.name).sort();
    const expected = ['compare', 'liberate', 'publish'];
    if (offered.join() !== expected.join()) {
      throw new Error(
        `Installed MCP server offers [${offered}]; expected the product verbs [${expected}].`
      );
    }
  } finally {
    await withDeadline(client.close(), 'Installed MCP server shutdown', 10_000);
  }

  process.stdout.write('Installed package CLI, capture engine, Platform API, MCP server, skills, and drivers are ready.\n');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
