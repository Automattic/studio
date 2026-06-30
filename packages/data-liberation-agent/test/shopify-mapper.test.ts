import { describe, it, expect } from 'vitest';
import {
  normalizeWeightToKg,
  shopifyGraphqlProductToWoo,
  shopifyProductToWoo,
  extractShopDomain,
} from '../src/adapters/shopify/index.js';
import type { ShopifyGqlProduct } from '../src/lib/extraction/shopify-graphql.js';

// --- normalizeWeightToKg ----------------------------------------------------

describe('normalizeWeightToKg', () => {
  it('returns undefined for missing or zero weight', () => {
    expect(normalizeWeightToKg(undefined, 'kg')).toBeUndefined();
    expect(normalizeWeightToKg(0, 'kg')).toBeUndefined();
  });

  it('passes kg through unchanged', () => {
    expect(normalizeWeightToKg(1.5, 'kg')).toBe('1.5');
  });

  it('converts grams to kg', () => {
    expect(normalizeWeightToKg(500, 'g')).toBe('0.5');
  });

  it('converts pounds to kg', () => {
    const out = normalizeWeightToKg(1, 'lb');
    expect(Number(out)).toBeCloseTo(0.4536, 3);
  });

  it('converts ounces to kg', () => {
    const out = normalizeWeightToKg(16, 'oz');
    expect(Number(out)).toBeCloseTo(0.4536, 3);
  });

  it('is case-insensitive on unit', () => {
    expect(normalizeWeightToKg(500, 'G')).toBe('0.5');
  });

  it('passes through unknown units unchanged', () => {
    expect(normalizeWeightToKg(2, 'stone')).toBe('2');
  });
});

// --- shopifyGraphqlProductToWoo --------------------------------------------

function mkNode(overrides: Partial<ShopifyGqlProduct> = {}): ShopifyGqlProduct {
  return {
    id: 'gid://Product/1',
    title: 'Widget',
    handle: 'widget',
    descriptionHtml: '<p>desc</p>',
    status: 'ACTIVE',
    vendor: 'ACME',
    tags: ['red', 'new'],
    productType: 'Gadgets',
    onlineStoreUrl: 'https://shop.example.com/products/widget',
    options: [{ name: 'Title', values: ['Default'] }],
    featuredMedia: null,
    media: { edges: [] },
    variants: { edges: [] },
    collections: { edges: [] },
    metafields: { edges: [] },
    ...overrides,
  };
}

function mkVariant(overrides: any = {}) {
  return {
    id: 'gid://Variant/1',
    sku: 'W-1',
    price: '19.99',
    compareAtPrice: null,
    inventoryPolicy: 'DENY' as const,
    inventoryQuantity: 10,
    inventoryItem: { tracked: true },
    selectedOptions: [],
    ...overrides,
  };
}

describe('shopifyGraphqlProductToWoo', () => {
  it('maps a simple product without a sale', () => {
    const node = mkNode({
      variants: { edges: [{ node: mkVariant() }] },
    });
    const { parent, variations } = shopifyGraphqlProductToWoo(node);
    expect(parent.type).toBe('simple');
    expect(parent.regularPrice).toBe('19.99');
    expect(parent.salePrice).toBeUndefined();
    expect(parent.inStock).toBe(true);
    expect(parent.stock).toBe(10);
    expect(variations).toHaveLength(0);
  });

  it('detects sale when compareAtPrice > price', () => {
    const node = mkNode({
      variants: { edges: [{ node: mkVariant({ price: '15.00', compareAtPrice: '25.00' }) }] },
    });
    const { parent } = shopifyGraphqlProductToWoo(node);
    expect(parent.regularPrice).toBe('25.00');
    expect(parent.salePrice).toBe('15.00');
  });

  it('does not false-positive sale when compareAtPrice == price', () => {
    const node = mkNode({
      variants: { edges: [{ node: mkVariant({ compareAtPrice: '19.99' }) }] },
    });
    const { parent } = shopifyGraphqlProductToWoo(node);
    expect(parent.salePrice).toBeUndefined();
  });

  it('tracked+DENY with zero stock → out of stock', () => {
    const node = mkNode({
      variants: { edges: [{ node: mkVariant({ inventoryQuantity: 0 }) }] },
    });
    const { parent } = shopifyGraphqlProductToWoo(node);
    expect(parent.inStock).toBe(false);
  });

  it('tracked+CONTINUE (oversell allowed) with zero stock → in stock', () => {
    const node = mkNode({
      variants: { edges: [{ node: mkVariant({ inventoryQuantity: 0, inventoryPolicy: 'CONTINUE' }) }] },
    });
    const { parent } = shopifyGraphqlProductToWoo(node);
    expect(parent.inStock).toBe(true);
  });

  it('untracked variant is always in stock regardless of policy', () => {
    const node = mkNode({
      variants: { edges: [{ node: mkVariant({
        inventoryItem: { tracked: false },
        inventoryQuantity: -5,
      }) }] },
    });
    const { parent } = shopifyGraphqlProductToWoo(node);
    expect(parent.inStock).toBe(true);
  });

  it('categories prefer collections and dedup', () => {
    const node = mkNode({
      collections: { edges: [
        { node: { id: '1', handle: 'shirts', title: 'Shirts' } },
        { node: { id: '2', handle: 'red-shirts', title: 'Shirts' } },
        { node: { id: '3', handle: 'new', title: 'New' } },
      ] },
    });
    const { parent } = shopifyGraphqlProductToWoo(node);
    expect(parent.categories).toEqual(['Shirts', 'New']);
  });

  it('falls back to productType when no collections', () => {
    const node = mkNode({ productType: 'Shoes' });
    const { parent } = shopifyGraphqlProductToWoo(node);
    expect(parent.categories).toEqual(['Shoes']);
  });

  it('SEO fields populate seoTitle/seoDescription (not shortDescription)', () => {
    const node = mkNode({
      seo: { title: 'Best widget', description: 'The widget of widgets' },
    });
    const { parent } = shopifyGraphqlProductToWoo(node);
    expect(parent.seoTitle).toBe('Best widget');
    expect(parent.seoDescription).toBe('The widget of widgets');
    expect(parent.shortDescription).toBeUndefined();
  });

  it('reads SEO metafields when seo object is missing', () => {
    const node = mkNode({
      metafields: { edges: [
        { node: { namespace: 'global', key: 'title_tag', value: 'Meta Title' } },
        { node: { namespace: 'global', key: 'description_tag', value: 'Meta Desc' } },
      ] },
    });
    const { parent } = shopifyGraphqlProductToWoo(node);
    expect(parent.seoTitle).toBe('Meta Title');
    expect(parent.seoDescription).toBe('Meta Desc');
  });

  it('maps unitCost to costOfGoods', () => {
    const node = mkNode({
      variants: { edges: [{ node: mkVariant({
        inventoryItem: {
          tracked: true,
          unitCost: { amount: '7.50', currencyCode: 'USD' },
        },
      }) }] },
    });
    const { parent } = shopifyGraphqlProductToWoo(node);
    expect(parent.costOfGoods).toBe('7.50');
  });

  it('normalizes weight from variant measurement', () => {
    const node = mkNode({
      variants: { edges: [{ node: mkVariant({
        inventoryItem: {
          tracked: true,
          measurement: { weight: { value: 500, unit: 'g' } },
        },
      }) }] },
    });
    const { parent } = shopifyGraphqlProductToWoo(node);
    expect(parent.weight).toBe('0.5');
  });

  it('maps variable product with variations', () => {
    const node = mkNode({
      options: [
        { name: 'Size', values: ['S', 'M'] },
        { name: 'Color', values: ['Red', 'Blue'] },
      ],
      variants: { edges: [
        { node: mkVariant({ sku: 'W-S-R', selectedOptions: [{ name: 'Size', value: 'S' }, { name: 'Color', value: 'Red' }] }) },
        { node: mkVariant({ sku: 'W-M-B', selectedOptions: [{ name: 'Size', value: 'M' }, { name: 'Color', value: 'Blue' }] }) },
      ] },
    });
    const { parent, variations } = shopifyGraphqlProductToWoo(node);
    expect(parent.type).toBe('variable');
    expect(parent.sku).toBe('widget'); // handle fallback
    expect(variations).toHaveLength(2);
    expect(variations[0].parentSku).toBe('widget');
    expect(variations[0].attributes?.length).toBe(2);
  });

  it('published reflects Shopify status', () => {
    const active = shopifyGraphqlProductToWoo(mkNode({ status: 'ACTIVE', variants: { edges: [{ node: mkVariant() }] } }));
    const draft = shopifyGraphqlProductToWoo(mkNode({ status: 'DRAFT', variants: { edges: [{ node: mkVariant() }] } }));
    expect(active.parent.published).toBe(true);
    expect(draft.parent.published).toBe(false);
  });
});

// --- shopifyProductToWoo (JSON-API path) — regression coverage for the
// simple-product sale fix that was added alongside the GraphQL path.
// ---------------------------------------------------------------------------

describe('extractShopDomain', () => {
  it('extracts from Shopify.shop global', () => {
    const html = `<script>var Shopify = Shopify || {};Shopify.shop = "my-store.myshopify.com";</script>`;
    expect(extractShopDomain(html)).toBe('my-store.myshopify.com');
  });

  it('extracts from trekkie analytics payload', () => {
    const html = `{"shopId":12345,"shop":"trekkie-store.myshopify.com"}`;
    expect(extractShopDomain(html)).toBe('trekkie-store.myshopify.com');
  });

  it('extracts from monorail shop payload', () => {
    const html = `{"monorail":true,"shop":"monorail-store.myshopify.com"}`;
    expect(extractShopDomain(html)).toBe('monorail-store.myshopify.com');
  });

  it('returns undefined when no pattern matches', () => {
    expect(extractShopDomain('<html></html>')).toBeUndefined();
  });

  it('handles single-quoted JS global', () => {
    const html = `<script>Shopify.shop = 'single-quoted.myshopify.com';</script>`;
    expect(extractShopDomain(html)).toBe('single-quoted.myshopify.com');
  });

  it('prefers Shopify.shop over other patterns', () => {
    const html = `
      <script>Shopify.shop = "primary.myshopify.com";</script>
      {"shop":"secondary.myshopify.com"}
    `;
    expect(extractShopDomain(html)).toBe('primary.myshopify.com');
  });
});

describe('shopifyProductToWoo (JSON API path)', () => {
  it('simple product with compareAtPrice marks sale price', () => {
    const { parent } = shopifyProductToWoo({
      title: 'Widget',
      body_html: '<p>desc</p>',
      handle: 'widget',
      variants: [{ title: 'Default', price: '15.00', compare_at_price: '25.00', sku: 'W-1' }],
      options: [{ name: 'Title', values: ['Default'] }],
    });
    expect(parent.regularPrice).toBe('25.00');
    expect(parent.salePrice).toBe('15.00');
  });

  it('no sale when compareAtPrice is missing', () => {
    const { parent } = shopifyProductToWoo({
      title: 'Widget',
      body_html: '',
      handle: 'widget',
      variants: [{ title: 'Default', price: '15.00', sku: 'W-1' }],
      options: [{ name: 'Title', values: ['Default'] }],
    });
    expect(parent.salePrice).toBeUndefined();
  });
});
