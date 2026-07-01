import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WooProductCsvBuilder } from '../src/lib/woo-csv/index.js';
import { readProductsCsv } from '../src/lib/import/woo-csv-reader.js';

describe('readProductsCsv', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'woo-csv-reader-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('round-trips simple products through write and read', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({
      name: 'Blue T-Shirt',
      sku: 'BLUE-TEE-001',
      regularPrice: '29.99',
      description: '<p>A nice blue t-shirt.</p>',
      categories: ['Clothing', 'Clothing > T-Shirts'],
      tags: ['summer', 'blue'],
      images: ['https://example.com/blue-tee.jpg', 'https://example.com/blue-tee-back.jpg'],
      inStock: true,
      stock: 50,
    });

    const csvPath = join(tempDir, 'products.csv');
    builder.serialize(csvPath);

    const products = readProductsCsv(csvPath);

    expect(products).toHaveLength(1);
    const p = products[0];

    expect(p.name).toBe('Blue T-Shirt');
    expect(p.sku).toBe('BLUE-TEE-001');
    expect(p.regularPrice).toBe('29.99');
    expect(p.description).toBe('<p>A nice blue t-shirt.</p>');
    expect(p.categories).toEqual(['Clothing', 'Clothing > T-Shirts']);
    expect(p.tags).toEqual(['summer', 'blue']);
    expect(p.images).toEqual([
      'https://example.com/blue-tee.jpg',
      'https://example.com/blue-tee-back.jpg',
    ]);
    expect(p.inStock).toBe(true);
    expect(p.stock).toBe(50);
  });

  it('round-trips variable products with variations', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({
      name: 'Variable T-Shirt',
      type: 'variable',
      sku: 'VAR-TEE',
      regularPrice: '34.99',
      attributes: [{ name: 'Size', values: ['S', 'M', 'L'], visible: true, global: true }],
    });
    builder.addProduct({
      name: 'Variable T-Shirt - Small',
      type: 'variation',
      sku: 'VAR-TEE-S',
      regularPrice: '34.99',
      parentSku: 'VAR-TEE',
      attributes: [{ name: 'Size', values: ['S'], visible: true, global: true }],
    });

    const csvPath = join(tempDir, 'products.csv');
    builder.serialize(csvPath);

    const products = readProductsCsv(csvPath);

    expect(products).toHaveLength(2);

    const parent = products[0];
    expect(parent.type).toBe('variable');
    expect(parent.sku).toBe('VAR-TEE');
    expect(parent.parentSku).toBeUndefined();

    const variation = products[1];
    expect(variation.type).toBe('variation');
    expect(variation.sku).toBe('VAR-TEE-S');
    expect(variation.parentSku).toBe('VAR-TEE');
  });

  it('returns empty array for non-existent file', () => {
    const products = readProductsCsv(join(tempDir, 'does-not-exist.csv'));
    expect(products).toEqual([]);
  });
});
