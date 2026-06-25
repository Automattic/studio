import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WooProductCsvBuilder } from './woo-product-csv.js';

describe('WooProductCsvBuilder sourceUrl round-trip', () => {
  it('preserves sourceUrl when streaming to JSONL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'woo-'));
    try {
      const b = new WooProductCsvBuilder();
      b.openStream(dir);
      b.addProduct({ name: 'A', sourceUrl: 'https://origin.example.com/p/a' });
      b.closeStream();
      const lines = readFileSync(join(dir, 'products.jsonl'), 'utf8').trim().split('\n');
      const parsed = JSON.parse(lines[0]);
      expect(parsed.sourceUrl).toBe('https://origin.example.com/p/a');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
