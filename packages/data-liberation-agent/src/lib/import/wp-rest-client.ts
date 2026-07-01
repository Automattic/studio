import { resolveSiteUrl, resolveSiteUrlSync } from './resolve-site-url.js';
import { httpJson } from './http-client.js';

export interface WpRestClientOptions {
  site: string;
  username: string;
  token: string;
  delay?: number;
  maxRetries?: number;
}

export class WpRestClient {
  readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly delay: number;
  private readonly maxRetries: number;

  constructor(options: WpRestClientOptions) {
    const { site, username, token } = options;
    this.delay = options.delay ?? 1000;
    this.maxRetries = options.maxRetries ?? 3;

    if (site.endsWith('.wordpress.com') || site === 'wordpress.com') {
      this.baseUrl = `https://public-api.wordpress.com/wp/v2/sites/${site}`;
    } else {
      const siteBase = resolveSiteUrlSync(site);
      this.baseUrl = `${siteBase}/wp-json/wp/v2`;
    }

    this.authHeader = `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;
  }

  static async create(options: WpRestClientOptions): Promise<WpRestClient> {
    const { site } = options;

    let resolvedSite: string;
    if (site.endsWith('.wordpress.com') || site === 'wordpress.com') {
      resolvedSite = site;
    } else {
      resolvedSite = await resolveSiteUrl(site);
    }

    return new WpRestClient({ ...options, site: resolvedSite });
  }

  async getCurrentUser(): Promise<{ id: number; slug: string; name: string }> {
    const data = await this.request(`${this.baseUrl}/users/me?context=edit`, {
      method: 'GET',
      headers: { 'Authorization': this.authHeader },
    });
    return data as { id: number; slug: string; name: string };
  }

  async listUsers(): Promise<Array<{ id: number; slug: string; name: string }>> {
    const data = await this.request(`${this.baseUrl}/users?per_page=100`, {
      method: 'GET',
      headers: { 'Authorization': this.authHeader },
    });
    return (data as Array<{ id: number; slug: string; name: string }>);
  }

  async createUser(input: {
    username: string; email?: string; name?: string; password?: string;
    roles?: string[];
  }): Promise<{ id: number }> {
    const body: Record<string, unknown> = {
      username: input.username,
      email: input.email || `${input.username}@imported.invalid`,
      name: input.name || input.username,
      password: input.password || crypto.randomUUID(),
      roles: input.roles || ['author'],
    };
    const data = await this.post('/users', body);
    return { id: data.id as number };
  }

  async createCategory(input: { name: string; slug: string; description: string; parent?: number }): Promise<{ id: number }> {
    const data = await this.post('/categories', input);
    return { id: data.id as number };
  }

  async createTag(input: { name: string; slug: string; description: string }): Promise<{ id: number }> {
    const data = await this.post('/tags', input);
    return { id: data.id as number };
  }

  async createTerm(taxonomy: string, input: { name: string; slug: string; description: string; parent?: number }): Promise<{ id: number }> {
    if (!/^[a-z0-9_-]+$/.test(taxonomy)) {
      throw new Error(`Invalid taxonomy name: ${taxonomy}`);
    }
    const data = await this.post(`/${taxonomy}`, input);
    return { id: data.id as number };
  }

  async createPage(input: {
    title: string; content: string; slug: string; excerpt?: string;
    date?: string; parent?: number; menuOrder?: number; author?: number; status: string;
  }): Promise<{ id: number; url: string }> {
    const body: Record<string, unknown> = { ...input };
    if (input.menuOrder !== undefined) {
      body.menu_order = input.menuOrder;
      delete body.menuOrder;
    }
    const data = await this.post('/pages', body);
    return { id: data.id as number, url: data.link as string };
  }

  async createPost(input: {
    title: string; content: string; slug: string; excerpt?: string;
    date?: string; categories?: number[]; tags?: number[];
    featuredMedia?: number; author?: number; status: string;
  }): Promise<{ id: number; url: string }> {
    const body: Record<string, unknown> = { ...input };
    if (input.featuredMedia !== undefined) {
      body.featured_media = input.featuredMedia;
      delete body.featuredMedia;
    }
    const data = await this.post('/posts', body);
    return { id: data.id as number, url: data.link as string };
  }

  async createMedia(
    file: Buffer | Uint8Array,
    filename: string,
    meta?: { altText?: string; caption?: string; title?: string },
  ): Promise<{ id: number; url: string }> {
    const safeFilename = filename.replace(/["\\\n\r]/g, '_');
    const data = await this.request(`${this.baseUrl}/media`, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
      },
      body: file as unknown as BodyInit,
    });

    // Set metadata via follow-up POST if provided — failure here is non-fatal
    if (meta && (meta.altText || meta.caption || meta.title)) {
      const update: Record<string, unknown> = {};
      if (meta.altText) update.alt_text = meta.altText;
      if (meta.caption) update.caption = meta.caption;
      if (meta.title) update.title = meta.title;
      try {
        await this.post(`/media/${data.id}`, update);
      } catch {
        // Media uploaded successfully but metadata update failed — non-fatal
      }
    }

    return { id: data.id as number, url: data.source_url as string };
  }

  async createComment(
    postId: number,
    input: { author: string; content: string; date: string; status: string },
  ): Promise<{ id: number }> {
    const body = {
      post: postId,
      author_name: input.author,
      content: input.content,
      date: input.date,
      status: input.status,
    };
    const data = await this.post('/comments', body);
    return { id: data.id as number };
  }

  async createMenu(input: { name: string; slug: string }): Promise<{ id: number }> {
    const data = await this.post('/menus', input);
    return { id: data.id as number };
  }

  async createMenuItem(input: {
    title: string; url: string; menuId: number; parent?: number; menuOrder?: number;
  }): Promise<{ id: number }> {
    const body: Record<string, unknown> = {
      title: input.title,
      url: input.url,
      menus: input.menuId,
    };
    if (input.parent !== undefined) body.parent = input.parent;
    if (input.menuOrder !== undefined) body.menu_order = input.menuOrder;
    const data = await this.post('/menu-items', body);
    return { id: data.id as number };
  }

  async updateSettings(settings: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post('/settings', settings);
  }

  private async post(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  private async request(url: string, init: { method: string; headers: Record<string, string>; body?: BodyInit }): Promise<any> {
    return httpJson(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      maxRetries: this.maxRetries,
      retryDelay: this.delay,
    });
  }
}
