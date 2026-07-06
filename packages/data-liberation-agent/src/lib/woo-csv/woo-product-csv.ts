import { writeFileSync, appendFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';
import Papa from 'papaparse';

// ---------------------------------------------------------------------------
// WooCommerce Product CSV Builder
// ---------------------------------------------------------------------------

export interface WooProduct {
  name: string;
  type?: 'simple' | 'variable' | 'grouped' | 'external' | 'variation';
  sku?: string;
  published?: boolean;
  description?: string;
  shortDescription?: string;
  regularPrice?: string;
  salePrice?: string;
  categories?: string[];
  tags?: string[];
  images?: string[];
  weight?: string;
  length?: string;
  width?: string;
  height?: string;
  inStock?: boolean;
  stock?: number;
  attributes?: Array<{
    name: string;
    values: string[];
    visible?: boolean;
    global?: boolean;
  }>;
  parentSku?: string;
  /** SEO title — emitted as `meta:_yoast_wpseo_title` */
  seoTitle?: string;
  /** SEO description — emitted as `meta:_yoast_wpseo_metadesc` */
  seoDescription?: string;
  /** Cost of goods sold — emitted as `meta:_wc_cog_cost` (WooCommerce COGS plugin) */
  costOfGoods?: string;
  /** Source URL of the product on the origin site. Used to cross-reference screenshots against the manifest. */
  sourceUrl?: string;
  /** Arbitrary custom post meta — each key becomes a `meta:<key>` column */
  meta?: Record<string, string>;
}

// WooCommerce post-meta keys for the three first-class SEO/cost fields.
// These columns are always present in the output (even when empty) so that
// the CSV shape is stable across runs and predictable for import tooling.
const META_KEY_SEO_TITLE = '_yoast_wpseo_title';
const META_KEY_SEO_DESC = '_yoast_wpseo_metadesc';
const META_KEY_COGS = '_wc_cog_cost';
const FIXED_META_KEYS = [META_KEY_SEO_TITLE, META_KEY_SEO_DESC, META_KEY_COGS] as const;


export class WooProductCsvBuilder {
  private products: WooProduct[] = [];

  addProduct(product: WooProduct): void {
    if (this._streaming) {
      this.flushProduct(product);
    } else {
      this.products.push(product);
    }
  }

  /**
   * Determine the maximum number of attribute columns needed across all products.
   */
  private maxAttributes(): number {
    let max = 0;
    for (const p of this.products) {
      if (p.attributes && p.attributes.length > max) {
        max = p.attributes.length;
      }
    }
    return max;
  }

  /**
   * Collect the union of custom `meta` keys across all products, excluding
   * the three fixed first-class keys (which always get a column regardless).
   */
  private customMetaKeys(): string[] {
    const keys = new Set<string>();
    for (const p of this.products) {
      if (!p.meta) continue;
      for (const k of Object.keys(p.meta)) {
        if ((FIXED_META_KEYS as readonly string[]).includes(k)) continue;
        keys.add(k);
      }
    }
    return [...keys].sort();
  }

  /**
   * Build the header row.
   */
  private buildHeaders(customMetaKeys: string[]): string[] {
    const headers = [
      'id',
      'type',
      'sku',
      'name',
      'published',
      'short_description',
      'description',
      'regular_price',
      'sale_price',
      'category_ids',
      'tag_ids',
      'images',
      'weight',
      'length',
      'width',
      'height',
      'stock_status',
      'stock_quantity',
    ];

    const attrCount = this.maxAttributes();
    for (let i = 1; i <= attrCount; i++) {
      headers.push(`attributes:name${i}`);
      headers.push(`attributes:value${i}`);
      headers.push(`attributes:visible${i}`);
      headers.push(`attributes:taxonomy${i}`);
    }

    headers.push('parent_id');

    // First-class meta columns — always present for a stable shape.
    for (const key of FIXED_META_KEYS) {
      headers.push(`meta:${key}`);
    }
    // Adapter-supplied custom meta keys.
    for (const key of customMetaKeys) {
      headers.push(`meta:${key}`);
    }

    return headers;
  }

  /**
   * Collapse newlines in a string value so CSV fields don't contain raw line breaks.
   * HTML content is unaffected visually since newlines are whitespace in HTML.
   */
  private static collapseNewlines(value: string): string {
    return value.replace(/\r?\n/g, ' ');
  }

  /**
   * Resolve the value for a given meta key on a product. The three fixed
   * keys read from their first-class fields first, then fall through to
   * `product.meta`. Custom keys read only from `product.meta`.
   */
  private static metaValue(product: WooProduct, key: string): string {
    if (key === META_KEY_SEO_TITLE && product.seoTitle) return product.seoTitle;
    if (key === META_KEY_SEO_DESC && product.seoDescription) return product.seoDescription;
    if (key === META_KEY_COGS && product.costOfGoods) return product.costOfGoods;
    return product.meta?.[key] || '';
  }

  /**
   * Build a CSV row for a single product.
   */
  private buildRow(product: WooProduct, attrCount: number, customMetaKeys: string[]): string[] {
    const c = WooProductCsvBuilder.collapseNewlines;
    const row: string[] = [
      '', // ID — empty for new products
      product.type || 'simple',
      product.sku || '',
      c(product.name),
      product.published === false ? '0' : '1',
      c(product.shortDescription || ''),
      c(product.description || ''),
      product.regularPrice || '',
      product.salePrice || '',
      product.categories ? product.categories.join(' | ') : '',
      product.tags ? product.tags.join(' | ') : '',
      product.images ? product.images.join(', ') : '',
      product.weight || '',
      product.length || '',
      product.width || '',
      product.height || '',
      product.inStock === false ? 'outofstock' : product.inStock === true ? 'instock' : '',
      product.stock != null ? String(product.stock) : '',
    ];

    for (let i = 0; i < attrCount; i++) {
      const attr = product.attributes?.[i];
      if (attr) {
        row.push(attr.name);
        row.push(attr.values.join(', '));
        row.push(attr.visible === false ? '0' : '1');
        row.push(attr.global === true ? '1' : '0');
      } else {
        row.push('', '', '', '');
      }
    }

    row.push(product.parentSku || '');

    for (const key of FIXED_META_KEYS) {
      row.push(c(WooProductCsvBuilder.metaValue(product, key)));
    }
    for (const key of customMetaKeys) {
      row.push(c(WooProductCsvBuilder.metaValue(product, key)));
    }

    return row;
  }

  /**
   * Serialize all products to a CSV file at the given path.
   */
  serialize(outputPath: string): void {
    mkdirSync(dirname(outputPath), { recursive: true });

    const customMetaKeys = this.customMetaKeys();
    const headers = this.buildHeaders(customMetaKeys);
    const attrCount = this.maxAttributes();

    const data = this.products.map(p => this.buildRow(p, attrCount, customMetaKeys));
    const csv = Papa.unparse({ fields: headers, data }, { newline: '\r\n' });
    writeFileSync(outputPath, csv, 'utf8');
  }

  // ---------------------------------------------------------------------------
  // Streaming mode — write products as JSONL, then build CSV from that
  // ---------------------------------------------------------------------------

  private _streamDir: string | null = null;
  private _jsonlPath: string | null = null;
  private _streaming = false;

  get isStreaming(): boolean {
    return this._streaming;
  }

  /**
   * Begin streaming mode. Products are appended as JSONL lines.
   * Pass `{ resume: true }` to append to an existing file instead of
   * truncating — required for adapters that persist cross-run state
   * (e.g. Shopify GraphQL product handles) in the extraction session.
   */
  openStream(outputDir: string, { resume = false }: { resume?: boolean } = {}): void {
    mkdirSync(outputDir, { recursive: true });
    this._streamDir = outputDir;
    this._jsonlPath = join(outputDir, 'products.jsonl');
    this._streaming = true;
    if (!resume) {
      writeFileSync(this._jsonlPath, '', 'utf8');
    }
  }

  /**
   * Append a product as a JSONL line. No memory accumulation.
   */
  flushProduct(product: WooProduct): void {
    if (!this._streaming || !this._jsonlPath) {
      throw new Error('Cannot flushProduct: streaming is not active. Call openStream() first.');
    }
    appendFileSync(this._jsonlPath, JSON.stringify(product) + '\n', 'utf8');
  }

  /**
   * End streaming. Reads the JSONL, computes maxAttributes, writes products.csv.
   * Returns the path to the CSV file.
   */
  closeStream(): string {
    if (!this._streaming || !this._jsonlPath || !this._streamDir) {
      throw new Error('Cannot closeStream: streaming is not active.');
    }

    const csvPath = join(this._streamDir, 'products.csv');
    const products = readJsonl(this._jsonlPath);

    if (products.length > 0) {
      // Temporarily load products to use existing serialize logic
      this.products = products;
      this.serialize(csvPath);
      this.products = [];
    }

    this._streaming = false;
    return csvPath;
  }
}

/**
 * Read a products.jsonl file back into WooProduct objects.
 */
function readJsonl(path: string): WooProduct[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8');
  const products: WooProduct[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      products.push(JSON.parse(line) as WooProduct);
    } catch {
      // Skip malformed lines
    }
  }
  return products;
}
