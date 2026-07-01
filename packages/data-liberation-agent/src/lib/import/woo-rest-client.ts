import { resolveSiteUrl, resolveSiteUrlSync } from './resolve-site-url.js';
import { httpFetch, extractErrorMessage } from './http-client.js';

export interface WooCommerceClientOptions {
  site: string;
  consumerKey?: string;
  consumerSecret?: string;
  /** WP username + application password, used as fallback when WC keys aren't provided */
  wpUsername?: string;
  wpToken?: string;
}

export class WooCommerceClient {
  readonly baseUrl: string;
  private readonly wpBaseUrl: string;
  private authHeader: string;
  private fallbackAuthHeader: string | undefined;
  private wpAuthHeader: string | undefined;
  private readonly categoryCache = new Map<string, number>();

  constructor(options: WooCommerceClientOptions) {
    const { site, consumerKey, consumerSecret, wpUsername, wpToken } = options;

    const siteBase = resolveSiteUrlSync(site);
    this.baseUrl = `${siteBase}/wp-json/wc/v3`;
    this.wpBaseUrl = `${siteBase}/wp-json/wp/v2`;

    if (wpUsername && wpToken) {
      this.wpAuthHeader = `Basic ${Buffer.from(`${wpUsername}:${wpToken}`).toString('base64')}`;
    }

    // Prefer WC consumer keys; fall back to WP application password on 401
    if (consumerKey && consumerSecret) {
      this.authHeader = `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`;
      if (wpUsername && wpToken) {
        this.fallbackAuthHeader = `Basic ${Buffer.from(`${wpUsername}:${wpToken}`).toString('base64')}`;
      }
    } else if (wpUsername && wpToken) {
      this.authHeader = `Basic ${Buffer.from(`${wpUsername}:${wpToken}`).toString('base64')}`;
    } else {
      throw new Error('WooCommerce client requires either consumer key/secret or WP username/token');
    }
  }

  static async create(options: WooCommerceClientOptions): Promise<WooCommerceClient> {
    const siteBase = await resolveSiteUrl(options.site);
    return new WooCommerceClient({ ...options, site: siteBase });
  }

  async createProduct(product: Record<string, unknown>): Promise<{ id: number }> {
    const data = await this.post('/products', product);
    const id = data.id as number;

    // WooCommerce over-encodes HTML entities in product names (& → &amp;).
    // Fix by patching the title via WP REST API which stores it correctly.
    const name = product.name as string | undefined;
    if (name && /[&<>]/.test(name) && this.wpAuthHeader) {
      await this.patchTitle(id, name);
    }

    return { id };
  }

  async createVariation(productId: number, variation: Record<string, unknown>): Promise<{ id: number }> {
    const data = await this.post(`/products/${productId}/variations`, variation);
    return { id: data.id as number };
  }

  /** Fix WooCommerce's over-encoding of HTML entities in product titles. */
  private async patchTitle(productId: number, rawTitle: string): Promise<void> {
    if (!this.wpAuthHeader) return;
    try {
      await fetch(`${this.wpBaseUrl}/product/${productId}`, {
        method: 'POST',
        headers: {
          'Authorization': this.wpAuthHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: rawTitle }),
        signal: AbortSignal.timeout(10000),
      });
    } catch { /* non-fatal */ }
  }

  async ensureCategory(name: string): Promise<number> {
    const cached = this.categoryCache.get(name);
    if (cached !== undefined) return cached;

    // Search for existing
    const results = await this.get(`/products/categories?search=${encodeURIComponent(name)}`) as Array<{ id: number; name: string }>;
    const match = results.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (match) {
      this.categoryCache.set(name, match.id);
      return match.id;
    }

    // Create new
    const data = await this.post('/products/categories', { name });
    const id = data.id as number;
    this.categoryCache.set(name, id);
    return id;
  }

  private async get(endpoint: string): Promise<unknown> {
    let response = await httpFetch(`${this.baseUrl}${endpoint}`, {
      headers: { Authorization: this.authHeader },
    });

    if (response.status === 401 && this.fallbackAuthHeader) {
      response = await httpFetch(`${this.baseUrl}${endpoint}`, {
        headers: { Authorization: this.fallbackAuthHeader },
      });
      if (response.ok) {
        this.authHeader = this.fallbackAuthHeader;
        this.fallbackAuthHeader = undefined;
      }
    }

    if (!response.ok) return [];
    return response.json();
  }

  private async post(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const makeRequest = (authHeader: string) =>
      httpFetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    let response = await makeRequest(this.authHeader);

    if (response.status === 401 && this.fallbackAuthHeader) {
      response = await makeRequest(this.fallbackAuthHeader);
      if (response.ok) {
        this.authHeader = this.fallbackAuthHeader;
        this.fallbackAuthHeader = undefined;
      }
    }

    if (!response.ok) {
      const message = await extractErrorMessage(response);
      throw new Error(`WooCommerce API ${response.status}: ${message}`);
    }

    return response.json();
  }
}
