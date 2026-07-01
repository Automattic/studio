import { describe, it, expect } from 'vitest';
import { BlockFixerClient } from './block-fixer-client.js';

describe('BlockFixerClient.rawConvert', () => {
  it('returns a passthrough sentinel per item when the server is not ready', async () => {
    const client = new BlockFixerClient(); // never started → not ready
    const out = await client.rawConvert(['<h2>Fictional</h2>', '<p>Copy.</p>']);
    expect(out).toEqual([
      { html: null, wpHtmlResidue: Infinity },
      { html: null, wpHtmlResidue: Infinity },
    ]);
  });

  it('returns [] for empty input', async () => {
    const client = new BlockFixerClient();
    expect(await client.rawConvert([])).toEqual([]);
  });
});
