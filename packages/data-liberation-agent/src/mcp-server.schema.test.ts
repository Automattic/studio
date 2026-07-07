import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read mcp-server.ts as TEXT (not import — importing starts the stdio server) and slice
// each tool's definition block so assertions are scoped to the right tool.
const here = dirname(fileURLToPath(import.meta.url));
const SERVER = readFileSync(join(here, 'mcp-server.ts'), 'utf8');

function toolBlock(name: string): string {
  const start = SERVER.indexOf(`name: '${name}'`);
  expect(start, `tool ${name} not found in mcp-server.ts`).toBeGreaterThan(-1);
  const next = SERVER.indexOf("name: 'liberate_", start + 1);
  return SERVER.slice(start, next === -1 ? undefined : next);
}

// The carry handler reads p.htmlSlug + p.postType and args.islandsOutDir; the server
// passes args RAW (no validation), so a schema that omits them "works" but lies — and
// without htmlSlug every page silently live-fetches (html/<slug>.html ≠ the namespaced
// capture filename). Keep the advertised schema honest. (Drift caught 2026-06-04.)
describe('liberate_reconstruct_pages_carry schema declares the handler contract', () => {
  const block = toolBlock('liberate_reconstruct_pages_carry');
  it.each(['htmlSlug', 'postType', 'islandsOutDir'])('declares %s', (field) => {
    expect(block).toContain(field);
  });
});
