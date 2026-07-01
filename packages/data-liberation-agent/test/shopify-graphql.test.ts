import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  fetchAllProducts,
  ShopifyGraphqlClient,
  type ShopifyGqlProduct,
} from '../src/lib/extraction/shopify-graphql.js';
import { ImportSession } from '../src/lib/resume-state/index.js';

// --- Test helpers -----------------------------------------------------------

/**
 * Minimal fake client that returns a scripted sequence of pages. Allows us to
 * exercise pagination, cursor resume, and pathological pageInfo shapes without
 * hitting the network.
 */
function makeFakeClient(pages: Array<{
  edges: Array<{ cursor: string; node: Partial<ShopifyGqlProduct> }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}>): ShopifyGraphqlClient {
  const client = new ShopifyGraphqlClient({
    shopDomain: 'fake.myshopify.com',
    accessToken: 'fake',
  });
  let idx = 0;
  // @ts-expect-error — override the request method for testing
  client.request = async () => {
    const page = pages[idx++] ?? { edges: [], pageInfo: { hasNextPage: false, endCursor: null } };
    return { products: page };
  };
  return client;
}

const mkProduct = (handle: string): Partial<ShopifyGqlProduct> => ({
  id: `gid://Product/${handle}`,
  handle,
  title: handle,
  descriptionHtml: '',
  status: 'ACTIVE',
  vendor: null,
  tags: [],
  productType: null,
  onlineStoreUrl: null,
  options: [],
  media: { edges: [] },
  variants: { edges: [] },
  collections: { edges: [] },
  metafields: { edges: [] },
});

// --- Tests ------------------------------------------------------------------

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gql-test-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('fetchAllProducts', () => {
  it('iterates multiple pages and calls onBatch for each', async () => {
    const client = makeFakeClient([
      { edges: [{ cursor: 'c1', node: mkProduct('a') }], pageInfo: { hasNextPage: true, endCursor: 'c1' } },
      { edges: [{ cursor: 'c2', node: mkProduct('b') }], pageInfo: { hasNextPage: false, endCursor: 'c2' } },
    ]);
    const batches: string[][] = [];
    await fetchAllProducts(client, {
      onBatch: (b) => { batches.push(b.map((p) => p.handle)); },
    });
    expect(batches).toEqual([['a'], ['b']]);
  });

  it('skips accumulation when onBatch is provided (memory-safe)', async () => {
    const client = makeFakeClient([
      { edges: [{ cursor: 'c1', node: mkProduct('a') }], pageInfo: { hasNextPage: false, endCursor: 'c1' } },
    ]);
    const all = await fetchAllProducts(client, { onBatch: () => {} });
    expect(all).toEqual([]);
  });

  it('returns all products when no onBatch is provided', async () => {
    const client = makeFakeClient([
      { edges: [{ cursor: 'c1', node: mkProduct('a') }, { cursor: 'c2', node: mkProduct('b') }], pageInfo: { hasNextPage: false, endCursor: 'c2' } },
    ]);
    const all = await fetchAllProducts(client);
    expect(all.map((p) => p.handle)).toEqual(['a', 'b']);
  });

  it('persists endCursor to session after each page and clears on success', async () => {
    const session = ImportSession.loadOrCreate(dir, 'shopify', {});
    const client = makeFakeClient([
      { edges: [{ cursor: 'c1', node: mkProduct('a') }], pageInfo: { hasNextPage: true, endCursor: 'c1' } },
      { edges: [{ cursor: 'c2', node: mkProduct('b') }], pageInfo: { hasNextPage: false, endCursor: 'c2' } },
    ]);
    await fetchAllProducts(client, { session, onBatch: () => {} });
    // Final cursor cleared
    expect(session.getCursor('shopify:products:endCursor')).toBeNull();
  });

  it('resumes from previously-persisted endCursor', async () => {
    const session = ImportSession.loadOrCreate(dir, 'shopify', {});
    session.setCursor('shopify:products:endCursor', 'resume-from-here');

    let capturedAfter: unknown;
    const client = new ShopifyGraphqlClient({ shopDomain: 'fake.myshopify.com', accessToken: 'x' });
    // @ts-expect-error override
    client.request = async (_q: string, vars: Record<string, unknown>) => {
      capturedAfter = vars.after;
      return { products: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } };
    };
    await fetchAllProducts(client, { session, onBatch: () => {} });
    expect(capturedAfter).toBe('resume-from-here');
  });

  it('throws when cursor does not advance (pagination loop guard)', async () => {
    const client = makeFakeClient([
      { edges: [{ cursor: 'same', node: mkProduct('a') }], pageInfo: { hasNextPage: true, endCursor: 'same' } },
      { edges: [{ cursor: 'same', node: mkProduct('a') }], pageInfo: { hasNextPage: true, endCursor: 'same' } },
    ]);
    await expect(fetchAllProducts(client, { onBatch: () => {} })).rejects.toThrow(/did not advance/);
  });

  it('handles an empty first page cleanly', async () => {
    const client = makeFakeClient([
      { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
    ]);
    const all = await fetchAllProducts(client);
    expect(all).toEqual([]);
  });
});
