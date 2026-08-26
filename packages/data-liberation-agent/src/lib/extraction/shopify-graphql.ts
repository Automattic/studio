import type { ImportSession } from '../resume-state/index.js';

/**
 * Minimal Shopify Admin GraphQL client.
 *
 * Pinning the API version prevents silent breakage when Shopify ships a
 * new version — Woo's migrator learned this the hard way and pins 2025-04.
 */
const API_VERSION = '2025-04';

export interface ShopifyGraphqlClientOpts {
  /** Shop hostname, e.g. `my-store.myshopify.com` */
  shopDomain: string;
  /** Admin API access token (X-Shopify-Access-Token header) */
  accessToken: string;
}

export interface GraphqlError {
  message: string;
  extensions?: Record<string, unknown>;
}

export class ShopifyGraphqlClient {
  readonly endpoint: string;
  private accessToken: string;

  constructor({ shopDomain, accessToken }: ShopifyGraphqlClientOpts) {
    const clean = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.endpoint = `https://${clean}/admin/api/${API_VERSION}/graphql.json`;
    this.accessToken = accessToken;
  }

  async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const resp = await fetch(this.endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.accessToken,
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Shopify GraphQL HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }

    const json = (await resp.json()) as { data?: T; errors?: GraphqlError[] };
    if (json.errors && json.errors.length > 0) {
      const msg = json.errors.map((e) => e.message).join('; ');
      throw new Error(`Shopify GraphQL errors: ${msg}`);
    }
    if (!json.data) {
      throw new Error('Shopify GraphQL: empty data field');
    }
    return json.data;
  }
}

// ---------------------------------------------------------------------------
// Product query — mirrors Woo's migrator shape; fetches everything we need
// for a rich WooCommerce import in a single round-trip per page.
// ---------------------------------------------------------------------------

const SHOPIFY_PRODUCT_QUERY = /* GraphQL */ `
  query GetShopifyProducts(
    $first: Int!,
    $after: String,
    $query: String,
    $variantsFirst: Int = 100
  ) {
    products(first: $first, after: $after, query: $query) {
      edges {
        cursor
        node {
          id
          title
          handle
          descriptionHtml
          status
          createdAt
          vendor
          tags
          productType
          onlineStoreUrl
          options(first: 10) { id name position values }
          featuredMedia {
            ... on MediaImage { id image { url altText } }
          }
          media(first: 50) {
            edges { node { ... on MediaImage { id image { url altText } } } }
          }
          variants(first: $variantsFirst) {
            edges {
              node {
                id
                sku
                price
                compareAtPrice
                inventoryPolicy
                inventoryQuantity
                inventoryItem {
                  tracked
                  unitCost { amount currencyCode }
                  measurement { weight { value unit } }
                }
                media(first: 1) {
                  edges { node { ... on MediaImage { image { url } } } }
                }
                selectedOptions { name value }
              }
            }
          }
          collections(first: 20) {
            edges { node { id handle title } }
          }
          metafields(first: 20, namespace: "global") {
            edges { node { namespace key value } }
          }
          seo { title description }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// ---------------------------------------------------------------------------
// Response types — narrow shapes of the fields we actually consume.
// ---------------------------------------------------------------------------

export interface ShopifyGqlImage {
  url: string;
  altText?: string | null;
}

export interface ShopifyGqlMediaEdge {
  node: { id?: string; image?: ShopifyGqlImage };
}

export interface ShopifyGqlVariant {
  id: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  // `taxable` and `position` intentionally omitted — queried fields should
  // be actually consumed downstream, and these two have no WooCommerce
  // counterpart in the current CSV output.
  inventoryPolicy: 'DENY' | 'CONTINUE';
  inventoryQuantity: number | null;
  inventoryItem?: {
    tracked: boolean;
    unitCost?: { amount: string; currencyCode: string } | null;
    measurement?: { weight?: { value: number; unit: string } | null } | null;
  };
  media?: { edges: ShopifyGqlMediaEdge[] };
  selectedOptions: Array<{ name: string; value: string }>;
}

export interface ShopifyGqlCollection {
  id: string;
  handle: string;
  title: string;
}

export interface ShopifyGqlMetafield {
  namespace: string;
  key: string;
  value: string;
}

export interface ShopifyGqlProduct {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  status: string;
  vendor: string | null;
  tags: string[];
  productType: string | null;
  onlineStoreUrl: string | null;
  options: Array<{ name: string; values: string[] }>;
  featuredMedia?: { image?: ShopifyGqlImage } | null;
  media: { edges: ShopifyGqlMediaEdge[] };
  variants: { edges: Array<{ node: ShopifyGqlVariant }> };
  collections: { edges: Array<{ node: ShopifyGqlCollection }> };
  metafields: { edges: Array<{ node: ShopifyGqlMetafield }> };
  seo?: { title: string | null; description: string | null };
}

interface ProductsResponse {
  products: {
    edges: Array<{ cursor: string; node: ShopifyGqlProduct }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

// ---------------------------------------------------------------------------
// Paginated fetcher with session cursor for resume.
// ---------------------------------------------------------------------------

export interface FetchProductsOpts {
  /** Page size — Shopify caps at 250 for products */
  pageSize?: number;
  /** GraphQL `query` filter string (e.g. `status:ACTIVE`) */
  filter?: string;
  /** Optional session for cursor persistence (resumable) */
  session?: ImportSession;
  /** Cursor key inside the session (lets multiple queries coexist) */
  cursorKey?: string;
  /** Called once per page — the caller processes the batch (e.g. maps to WooProduct) */
  onBatch?: (products: ShopifyGqlProduct[]) => void | Promise<void>;
}

/**
 * Iterate every product in the shop, calling `onBatch` per page. When a
 * session is provided, the latest `endCursor` is persisted after each page
 * so a subsequent run can resume mid-catalog.
 */
export async function fetchAllProducts(
  client: ShopifyGraphqlClient,
  {
    pageSize = 50,
    filter,
    session,
    cursorKey = 'shopify:products:endCursor',
    onBatch,
  }: FetchProductsOpts = {},
): Promise<ShopifyGqlProduct[]> {
  // Only accumulate the full list when the caller has no streaming sink.
  // For a 100k-product catalog the accumulator can easily cost hundreds of
  // MB otherwise, and the shopify.ts caller discards the return value.
  const retain = !onBatch;
  const all: ShopifyGqlProduct[] = [];
  let after: string | null = session?.getCursor<string>(cursorKey) ?? null;

  // Sanity caps: large but bounded. Prevents an infinite loop if the API
  // ever returns `hasNextPage: true` with a non-advancing cursor.
  const MAX_PAGES = 10000;
  let pages = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (++pages > MAX_PAGES) {
      throw new Error(`Shopify GraphQL pagination exceeded ${MAX_PAGES} pages — aborting`);
    }

    const data: ProductsResponse = await client.request<ProductsResponse>(SHOPIFY_PRODUCT_QUERY, {
      first: pageSize,
      after,
      query: filter ?? null,
    });

    const edges = data.products.edges;
    const batch = edges.map((e) => e.node);
    if (retain) all.push(...batch);
    if (onBatch && batch.length > 0) await onBatch(batch);

    const { hasNextPage, endCursor } = data.products.pageInfo;
    if (session && endCursor) session.setCursor(cursorKey, endCursor);

    if (!hasNextPage || !endCursor) break;
    // Detect non-advancing cursor: if the endCursor matches the cursor we
    // just sent in the request, the next page would fetch the same data.
    if (endCursor === after) {
      throw new Error('Shopify GraphQL pagination cursor did not advance — aborting');
    }
    after = endCursor;
  }

  // Pagination complete — clear cursor so the next fresh run starts over
  if (session) session.setCursor(cursorKey, null);

  return all;
}
