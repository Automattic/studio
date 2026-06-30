#!/usr/bin/env tsx
//
// Integration smoke for BlockFixerClient. Spawns the subprocess, fixes
// a representative composed-blocks payload (heading + paragraph +
// nested-<p> hazard), prints the result, and shuts down. Not part of
// the regular test suite — the WP block library load is heavy.
//
// Usage: tsx scripts/block-fixer/test-client.ts
//

import { BlockFixerClient } from '../../src/lib/streaming/block-fixer-client.js';

const SAMPLE = [
  '<!-- wp:heading {"level":1} -->',
  '<h1>Welcome</h1>',
  '<!-- /wp:heading -->',
  '<!-- wp:paragraph -->',
  '<p class="outer"><p class="inner">Nested paragraph hazard.</p></p>',
  '<!-- /wp:paragraph -->',
  '<!-- wp:paragraph -->',
  '<p>Plain paragraph.</p>',
  '<!-- /wp:paragraph -->',
].join('\n');

async function main(): Promise<void> {
  const client = new BlockFixerClient((msg) => process.stderr.write(`[client] ${msg}\n`));
  const t0 = Date.now();
  await client.start({ healthTimeoutMs: 15_000 });
  const tReady = Date.now();
  console.log(`startup: ${tReady - t0}ms`);

  const tFixStart = Date.now();
  const [result] = await client.fix([SAMPLE]);
  const tFixEnd = Date.now();
  console.log(`fix: ${tFixEnd - tFixStart}ms, changed=${result.changed}, issues=${result.fixedIssues.length}`);
  console.log('--- input ---');
  console.log(SAMPLE);
  console.log('--- output ---');
  console.log(result.html);
  if (result.fixedIssues.length > 0) {
    console.log('--- issues ---');
    for (const issue of result.fixedIssues) console.log('  -', issue);
  }

  const tStopStart = Date.now();
  await client.stop();
  console.log(`stop: ${Date.now() - tStopStart}ms`);
}

main().catch((err) => {
  console.error('test-client failed:', err);
  process.exit(1);
});
