import { readFileSync, existsSync } from 'fs';
import Papa from 'papaparse';
import type { WooProduct } from '../woo-csv/index.js';

/**
 * Read a WooCommerce product CSV file written by WooProductCsvBuilder
 * and return an array of WooProduct objects.
 * Uses WooCommerce internal field names as column headers.
 * Returns an empty array if the file does not exist.
 */
export function readProductsCsv(csvPath: string): WooProduct[] {
  if (!existsSync(csvPath)) {
    return [];
  }

  const content = readFileSync(csvPath, 'utf8');
  const { data: rows } = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
  });

  const products: WooProduct[] = [];

  for (const row of rows) {
    const get = (name: string): string => row[name] ?? '';

    const product: WooProduct = {
      name: get('name'),
    };

    const type = get('type');
    if (type) {
      product.type = type as WooProduct['type'];
    }

    const sku = get('sku');
    if (sku) product.sku = sku;

    const published = get('published');
    if (published !== '') {
      product.published = published !== '0';
    }

    const description = get('description');
    if (description) product.description = description;

    const shortDescription = get('short_description');
    if (shortDescription) product.shortDescription = shortDescription;

    const regularPrice = get('regular_price');
    if (regularPrice) product.regularPrice = regularPrice;

    const salePrice = get('sale_price');
    if (salePrice) product.salePrice = salePrice;

    const categories = get('category_ids');
    if (categories) product.categories = categories.split(' | ');

    const tags = get('tag_ids');
    if (tags) product.tags = tags.split(' | ');

    const images = get('images');
    if (images) product.images = images.split(', ');

    const weight = get('weight');
    if (weight) product.weight = weight;

    const length = get('length');
    if (length) product.length = length;

    const width = get('width');
    if (width) product.width = width;

    const height = get('height');
    if (height) product.height = height;

    const stockStatus = get('stock_status');
    if (stockStatus !== '') {
      product.inStock = stockStatus === 'instock' || stockStatus === '1';
    }

    const stockQty = get('stock_quantity');
    if (stockQty !== '') {
      const parsed = parseInt(stockQty, 10);
      if (!isNaN(parsed)) product.stock = parsed;
    }

    // Read attributes (columns attributes:nameN/valueN/visibleN/taxonomyN, N = 1..10)
    const attributes: WooProduct['attributes'] = [];
    for (let n = 1; n <= 10; n++) {
      const attrName = get(`attributes:name${n}`);
      if (!attrName) break;
      const valuesStr = get(`attributes:value${n}`);
      const visible = get(`attributes:visible${n}`);
      const global = get(`attributes:taxonomy${n}`);
      attributes.push({
        name: attrName,
        values: valuesStr ? valuesStr.split(', ') : [],
        visible: visible !== '0',
        global: global === '1',
      });
    }
    if (attributes.length > 0) {
      product.attributes = attributes;
    }

    const parentSku = get('parent_id');
    if (parentSku) product.parentSku = parentSku;

    products.push(product);
  }

  return products;
}
