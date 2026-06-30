import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WooProductCsvBuilder } from '../src/lib/woo-csv/index.js';

describe('WooProductCsvBuilder', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'woo-csv-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function buildAndRead(builder: WooProductCsvBuilder): string {
    const csvPath = join(tempDir, 'products.csv');
    builder.serialize(csvPath);
    return readFileSync(csvPath, 'utf8');
  }

  function parseRows(csv: string): string[][] {
    // Simple CSV parser that handles quoted fields
    const rows: string[][] = [];
    const lines = csv.split(/\r?\n/);
    for (const line of lines) {
      if (!line) continue;
      const fields: string[] = [];
      let i = 0;
      while (i <= line.length) {
        if (i === line.length) {
          fields.push('');
          break;
        }
        if (line[i] === '"') {
          // Quoted field
          let val = '';
          i++; // skip opening quote
          while (i < line.length) {
            if (line[i] === '"' && i + 1 < line.length && line[i + 1] === '"') {
              val += '"';
              i += 2;
            } else if (line[i] === '"') {
              i++; // skip closing quote
              break;
            } else {
              val += line[i];
              i++;
            }
          }
          fields.push(val);
          if (i < line.length && line[i] === ',') i++; // skip comma
        } else {
          // Unquoted field
          const nextComma = line.indexOf(',', i);
          if (nextComma === -1) {
            fields.push(line.slice(i));
            break;
          } else {
            fields.push(line.slice(i, nextComma));
            i = nextComma + 1;
          }
        }
      }
      rows.push(fields);
    }
    return rows;
  }

  it('serializes simple products to CSV', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({
      name: 'Blue T-Shirt',
      sku: 'BLUE-TEE-001',
      regularPrice: '29.99',
      description: '<p>A nice blue t-shirt.</p>',
      categories: ['Clothing'],
      tags: ['summer', 'blue'],
      images: ['https://example.com/blue-tee.jpg'],
      inStock: true,
      stock: 50,
    });

    const csv = buildAndRead(builder);
    const rows = parseRows(csv);

    // Check headers use WooCommerce internal field names
    expect(rows[0]).toContain('id');
    expect(rows[0]).toContain('type');
    expect(rows[0]).toContain('sku');
    expect(rows[0]).toContain('name');
    expect(rows[0]).toContain('published');
    expect(rows[0]).toContain('regular_price');
    expect(rows[0]).toContain('category_ids');
    expect(rows[0]).toContain('tag_ids');
    expect(rows[0]).toContain('images');

    // Check data row
    const dataRow = rows[1];
    const headerRow = rows[0];
    const idx = (name: string) => headerRow.indexOf(name);

    expect(dataRow[idx('id')]).toBe('');
    expect(dataRow[idx('type')]).toBe('simple');
    expect(dataRow[idx('sku')]).toBe('BLUE-TEE-001');
    expect(dataRow[idx('name')]).toBe('Blue T-Shirt');
    expect(dataRow[idx('published')]).toBe('1');
    expect(dataRow[idx('regular_price')]).toBe('29.99');
    expect(dataRow[idx('category_ids')]).toBe('Clothing');
    expect(dataRow[idx('tag_ids')]).toBe('summer | blue');
    expect(dataRow[idx('images')]).toBe('https://example.com/blue-tee.jpg');
    expect(dataRow[idx('stock_status')]).toBe('instock');
    expect(dataRow[idx('stock_quantity')]).toBe('50');
  });

  it('serializes variable products with attributes', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({
      name: 'Variable T-Shirt',
      type: 'variable',
      sku: 'VAR-TEE',
      regularPrice: '34.99',
      attributes: [
        { name: 'Size', values: ['S', 'M', 'L'], visible: true, global: true },
        { name: 'Color', values: ['Red', 'Blue'], visible: true, global: false },
      ],
    });

    const csv = buildAndRead(builder);
    const rows = parseRows(csv);

    const headerRow = rows[0];
    expect(headerRow).toContain('attributes:name1');
    expect(headerRow).toContain('attributes:value1');
    expect(headerRow).toContain('attributes:visible1');
    expect(headerRow).toContain('attributes:taxonomy1');
    expect(headerRow).toContain('attributes:name2');
    expect(headerRow).toContain('attributes:value2');

    const dataRow = rows[1];
    const idx = (name: string) => headerRow.indexOf(name);

    expect(dataRow[idx('type')]).toBe('variable');
    expect(dataRow[idx('attributes:name1')]).toBe('Size');
    expect(dataRow[idx('attributes:value1')]).toBe('S, M, L');
    expect(dataRow[idx('attributes:visible1')]).toBe('1');
    expect(dataRow[idx('attributes:taxonomy1')]).toBe('1');
    expect(dataRow[idx('attributes:name2')]).toBe('Color');
    expect(dataRow[idx('attributes:value2')]).toBe('Red, Blue');
    expect(dataRow[idx('attributes:visible2')]).toBe('1');
    expect(dataRow[idx('attributes:taxonomy2')]).toBe('0');
  });

  it('handles categories with hierarchy', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({
      name: 'Graphic Tee',
      categories: ['Clothing', 'Clothing > T-Shirts'],
    });

    const csv = buildAndRead(builder);
    const rows = parseRows(csv);
    const headerRow = rows[0];
    const dataRow = rows[1];
    const idx = (name: string) => headerRow.indexOf(name);

    expect(dataRow[idx('category_ids')]).toBe('Clothing | Clothing > T-Shirts');
  });

  it('handles multiple images', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({
      name: 'Multi-Image Product',
      images: [
        'https://example.com/main.jpg',
        'https://example.com/side.jpg',
        'https://example.com/back.jpg',
      ],
    });

    const csv = buildAndRead(builder);
    const rows = parseRows(csv);
    const headerRow = rows[0];
    const dataRow = rows[1];
    const idx = (name: string) => headerRow.indexOf(name);

    expect(dataRow[idx('images')]).toBe(
      'https://example.com/main.jpg, https://example.com/side.jpg, https://example.com/back.jpg'
    );
  });

  it('escapes CSV fields correctly', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({
      name: 'Product with "quotes"',
      description: '<p>Has commas, "quotes", and\nnewlines</p>',
      shortDescription: 'Simple text',
    });

    const csv = buildAndRead(builder);

    // The name should be quoted with escaped double-quotes
    expect(csv).toContain('"Product with ""quotes"""');

    // Newlines in content are collapsed to spaces for RFC 4180 compliance
    expect(csv).toContain('"<p>Has commas, ""quotes"", and newlines</p>"');
  });

  it('writes empty string for missing optional fields', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({
      name: 'Minimal Product',
    });

    const csv = buildAndRead(builder);
    const rows = parseRows(csv);
    const headerRow = rows[0];
    const dataRow = rows[1];
    const idx = (name: string) => headerRow.indexOf(name);

    expect(dataRow[idx('name')]).toBe('Minimal Product');
    expect(dataRow[idx('sku')]).toBe('');
    expect(dataRow[idx('description')]).toBe('');
    expect(dataRow[idx('short_description')]).toBe('');
    expect(dataRow[idx('regular_price')]).toBe('');
    expect(dataRow[idx('sale_price')]).toBe('');
    expect(dataRow[idx('category_ids')]).toBe('');
    expect(dataRow[idx('tag_ids')]).toBe('');
    expect(dataRow[idx('images')]).toBe('');
    expect(dataRow[idx('weight')]).toBe('');
    expect(dataRow[idx('stock_status')]).toBe('');
    expect(dataRow[idx('stock_quantity')]).toBe('');
    expect(dataRow[idx('parent_id')]).toBe('');
    // Type defaults to simple
    expect(dataRow[idx('type')]).toBe('simple');
    // Published defaults to 1
    expect(dataRow[idx('published')]).toBe('1');
  });

  it('handles draft (unpublished) products', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({
      name: 'Draft Product',
      published: false,
    });

    const csv = buildAndRead(builder);
    const rows = parseRows(csv);
    const headerRow = rows[0];
    const dataRow = rows[1];
    const idx = (name: string) => headerRow.indexOf(name);

    expect(dataRow[idx('published')]).toBe('0');
  });

  it('handles product variations with parentSku', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({
      name: 'Parent Shirt',
      type: 'variable',
      sku: 'SHIRT-001',
      attributes: [
        { name: 'Size', values: ['S', 'M', 'L'] },
      ],
    });
    builder.addProduct({
      name: 'Parent Shirt - Small',
      sku: 'SHIRT-001-S',
      regularPrice: '19.99',
      parentSku: 'SHIRT-001',
      attributes: [
        { name: 'Size', values: ['S'] },
      ],
    });

    const csv = buildAndRead(builder);
    const rows = parseRows(csv);
    const headerRow = rows[0];
    const idx = (name: string) => headerRow.indexOf(name);

    // Parent row
    expect(rows[1][idx('parent_id')]).toBe('');
    // Variation row
    expect(rows[2][idx('parent_id')]).toBe('SHIRT-001');
    expect(rows[2][idx('sku')]).toBe('SHIRT-001-S');
  });

  it('serializes multiple products', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({ name: 'Product A', sku: 'A' });
    builder.addProduct({ name: 'Product B', sku: 'B' });
    builder.addProduct({ name: 'Product C', sku: 'C' });

    const csv = buildAndRead(builder);
    const rows = parseRows(csv);

    // 1 header + 3 data rows
    expect(rows.length).toBe(4);
  });

  it('streams products as JSONL then builds CSV on closeStream', () => {
    const builder = new WooProductCsvBuilder();
    builder.openStream(tempDir);

    builder.addProduct({ name: 'Streamed A', sku: 'SA', regularPrice: '10.00' });
    builder.addProduct({ name: 'Streamed B', sku: 'SB', regularPrice: '20.00', attributes: [{ name: 'Color', values: ['Red', 'Blue'], visible: true, global: false }] });

    // JSONL should exist before closeStream
    const jsonlPath = join(tempDir, 'products.jsonl');
    expect(existsSync(jsonlPath)).toBe(true);
    const lines = readFileSync(jsonlPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).name).toBe('Streamed A');

    // Close stream — should produce CSV
    const csvPath = builder.closeStream();
    expect(existsSync(csvPath)).toBe(true);

    const csv = readFileSync(csvPath, 'utf8');
    const rows = parseRows(csv);
    expect(rows).toHaveLength(3); // header + 2 products
    expect(rows[1][3]).toBe('Streamed A'); // name column
    expect(rows[2][3]).toBe('Streamed B');
    // Should have attribute columns from product B
    expect(csv).toContain('attributes:name1');
    expect(csv).toContain('Color');
  });

  it('emits fixed meta columns for SEO title/desc and cost of goods', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({
      name: 'Widget',
      seoTitle: 'Best Widget Ever',
      seoDescription: 'The finest widget available',
      costOfGoods: '4.25',
    });

    const csv = buildAndRead(builder);
    const rows = parseRows(csv);
    const idx = (name: string) => rows[0].indexOf(name);

    expect(idx('meta:_yoast_wpseo_title')).toBeGreaterThan(-1);
    expect(idx('meta:_yoast_wpseo_metadesc')).toBeGreaterThan(-1);
    expect(idx('meta:_wc_cog_cost')).toBeGreaterThan(-1);
    expect(dataRow(rows, 1, idx('meta:_yoast_wpseo_title'))).toBe('Best Widget Ever');
    expect(dataRow(rows, 1, idx('meta:_yoast_wpseo_metadesc'))).toBe('The finest widget available');
    expect(dataRow(rows, 1, idx('meta:_wc_cog_cost'))).toBe('4.25');
  });

  it('fixed meta columns are always present even when empty', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({ name: 'Bare' });
    const csv = buildAndRead(builder);
    expect(csv).toContain('meta:_yoast_wpseo_title');
    expect(csv).toContain('meta:_yoast_wpseo_metadesc');
    expect(csv).toContain('meta:_wc_cog_cost');
  });

  it('emits columns for adapter-supplied custom meta keys', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({ name: 'A', meta: { _custom_field: 'alpha' } });
    builder.addProduct({ name: 'B', meta: { _custom_field: 'beta', _other: 'gamma' } });
    const csv = buildAndRead(builder);
    const rows = parseRows(csv);
    const idx = (name: string) => rows[0].indexOf(name);

    expect(idx('meta:_custom_field')).toBeGreaterThan(-1);
    expect(idx('meta:_other')).toBeGreaterThan(-1);
    expect(dataRow(rows, 1, idx('meta:_custom_field'))).toBe('alpha');
    expect(dataRow(rows, 2, idx('meta:_other'))).toBe('gamma');
  });

  it('first-class fields take precedence over meta[] for the same key', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({
      name: 'Widget',
      seoTitle: 'From field',
      meta: { _yoast_wpseo_title: 'From meta' },
    });
    const csv = buildAndRead(builder);
    const rows = parseRows(csv);
    const idx = (name: string) => rows[0].indexOf(name);
    expect(dataRow(rows, 1, idx('meta:_yoast_wpseo_title'))).toBe('From field');
  });

  it('uses instock/outofstock for stock_status', () => {
    const builder = new WooProductCsvBuilder();
    builder.addProduct({ name: 'In Stock', inStock: true });
    builder.addProduct({ name: 'Out of Stock', inStock: false });

    const csv = buildAndRead(builder);
    const rows = parseRows(csv);
    const headerRow = rows[0];
    const idx = (name: string) => headerRow.indexOf(name);

    expect(dataRow(rows, 1, idx('stock_status'))).toBe('instock');
    expect(dataRow(rows, 2, idx('stock_status'))).toBe('outofstock');
  });
});

function dataRow(rows: string[][], rowIdx: number, colIdx: number): string {
  return rows[rowIdx][colIdx];
}
