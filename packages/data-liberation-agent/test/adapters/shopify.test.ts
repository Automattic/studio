import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { shopifyAdapter } from '../../src/adapters/shopify/index.js';
import { WxrBuilder } from '../../src/lib/wxr/index.js';

describe('shopifyAdapter', () => {
  it('has id "shopify"', () => {
    expect(shopifyAdapter.id).toBe('shopify');
  });

  it('detects myshopify.com URLs', () => {
    expect(shopifyAdapter.detect('https://mystore.myshopify.com')).toBe(true);
    expect(shopifyAdapter.detect('https://mystore.myshopify.com/blogs/news')).toBe(true);
  });

  it('detects shopify.com URLs', () => {
    expect(shopifyAdapter.detect('https://shopify.com')).toBe(true);
    expect(shopifyAdapter.detect('https://www.shopify.com/something')).toBe(true);
  });

  it('does not detect non-Shopify URLs', () => {
    expect(shopifyAdapter.detect('https://www.example.com')).toBe(false);
    expect(shopifyAdapter.detect('https://mysite.squarespace.com')).toBe(false);
    expect(shopifyAdapter.detect('https://mysite.wixsite.com/blog')).toBe(false);
    expect(shopifyAdapter.detect('https://mysite.webflow.io')).toBe(false);
  });

  it('has discover method', () => {
    expect(typeof shopifyAdapter.discover).toBe('function');
  });

  it('has extract method', () => {
    expect(typeof shopifyAdapter.extract).toBe('function');
  });
});

describe('Shopify WXR integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'shopify-e2e-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('builds valid WXR from fixture JSON article data', () => {
    const fixture = JSON.parse(readFileSync('test/fixtures/shopify-article.json', 'utf8'));
    const article = fixture.article;

    const wxr = new WxrBuilder({
      title: 'Bean Counter Coffee',
      url: 'https://bean-counter-coffee.myshopify.com',
      description: 'Premium coffee beans and brewing guides',
      language: 'en',
    });

    // Parse tags from comma-separated string (Shopify format)
    const tags = article.tags.split(',').map((t: string) => t.trim()).filter(Boolean);

    wxr.addPost({
      title: article.title,
      slug: article.handle,
      content: article.body_html,
      excerpt: '',
      date: article.published_at,
      seoTitle: article.title,
      seoDescription: '',
      tags,
    });

    // Register tags
    for (const tag of tags) {
      wxr.addTag({ slug: tag, name: tag });
    }

    // Add media from the fixture
    wxr.addMedia({
      url: article.image.src,
      localPath: 'media/coffee-beans.jpg',
      title: 'coffee-beans.jpg',
    });

    // Add a page
    wxr.addPage({
      title: 'About',
      slug: 'about',
      content: '<p>Bean Counter Coffee was founded by coffee enthusiasts.</p>',
      excerpt: 'Our story',
      seoTitle: 'About - Bean Counter Coffee',
      seoDescription: 'Learn about our story.',
    });

    // Add navigation
    wxr.addMenuItem({
      title: 'Home',
      url: 'https://bean-counter-coffee.myshopify.com/',
      menuSlug: 'main-menu',
      order: 1,
    });
    wxr.addMenuItem({
      title: 'Blog',
      url: 'https://bean-counter-coffee.myshopify.com/blogs/news',
      menuSlug: 'main-menu',
      order: 2,
    });

    wxr.addRedirect({
      from: '/blogs/news/how-to-choose-the-best-coffee-beans',
      to: '/how-to-choose-the-best-coffee-beans',
    });

    const wxrPath = join(tempDir, 'output.wxr');
    const { validation } = wxr.serialize(wxrPath);

    expect(existsSync(wxrPath)).toBe(true);
    const xml = readFileSync(wxrPath, 'utf8');

    // Verify structure
    expect(xml).toContain('<wp:wxr_version>1.2</wp:wxr_version>');
    expect(xml).toContain('<title>Bean Counter Coffee</title>');

    // Verify blog post content
    expect(xml).toContain('<title>How to Choose the Best Coffee Beans</title>');
    expect(xml).toContain('<wp:post_type>post</wp:post_type>');
    expect(xml).toContain('Choosing the right coffee beans');
    expect(xml).toContain('Origins Matter');

    // Verify page
    expect(xml).toContain('<title>About</title>');
    expect(xml).toContain('<wp:post_type>page</wp:post_type>');

    // Verify tags
    expect(xml).toContain('coffee');
    expect(xml).toContain('guide');
    expect(xml).toContain('beans');

    // Verify media
    expect(xml).toContain('<wp:post_type>attachment</wp:post_type>');
    expect(xml).toContain('cdn.shopify.com');

    // Verify nav menu items
    expect(xml).toContain('<wp:post_type>nav_menu_item</wp:post_type>');

    // Verify redirect map
    const redirectPath = join(tempDir, 'redirect-map.json');
    expect(existsSync(redirectPath)).toBe(true);
    const redirects = JSON.parse(readFileSync(redirectPath, 'utf8'));
    expect(redirects).toHaveLength(1);
    expect(redirects[0].from).toBe('/blogs/news/how-to-choose-the-best-coffee-beans');

    // Validate
    expect(validation.valid).toBe(true);
  });

  it('fixture HTML has Shopify markers', () => {
    const html = readFileSync('test/fixtures/shopify-blog-post.html', 'utf8');
    expect(html).toContain('cdn.shopify.com');
    expect(html).toContain('Shopify.theme');
    expect(html).toContain('itemscope');
    expect(html).toContain('class="article__content rte"');
    expect(html).toContain('schema.org/BlogPosting');
  });

  it('fixture HTML content can be extracted with .rte strategy', () => {
    const html = readFileSync('test/fixtures/shopify-blog-post.html', 'utf8');

    // Extract .rte content the same way the adapter would
    const rteStart = html.match(/<div[^>]*class="[^"]*\brte\b[^"]*"[^>]*>/i);
    expect(rteStart).not.toBeNull();

    if (rteStart) {
      const startIdx = html.indexOf(rteStart[0]) + rteStart[0].length;
      let depth = 1;
      let i = startIdx;
      let content = '';
      while (i < html.length && depth > 0) {
        const nextOpen = html.indexOf('<div', i);
        const nextClose = html.indexOf('</div>', i);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          i = nextOpen + 4;
        } else {
          depth--;
          if (depth === 0) {
            content = html.slice(startIdx, nextClose).trim();
          }
          i = nextClose + 6;
        }
      }

      expect(content).toContain('Choosing the right coffee beans');
      expect(content).toContain('Origins Matter');
      expect(content).toContain('Roast Levels');
      expect(content).toContain('Freshness Is Key');
      expect(content).toContain('cdn.shopify.com');
    }
  });

  it('fixture JSON article has expected fields', () => {
    const fixture = JSON.parse(readFileSync('test/fixtures/shopify-article.json', 'utf8'));
    const article = fixture.article;

    expect(article.id).toBe(123456);
    expect(article.title).toBe('How to Choose the Best Coffee Beans');
    expect(article.body_html).toContain('Choosing the right coffee beans');
    expect(article.author).toBe('Coffee Expert');
    expect(article.tags).toBe('coffee, guide, beans');
    expect(article.published_at).toBe('2026-01-15T10:00:00-05:00');
    expect(article.image.src).toContain('cdn.shopify.com');
    expect(article.handle).toBe('how-to-choose-the-best-coffee-beans');
    expect(article.blog_id).toBe(789);
  });
});

describe('shopifyProductToWoo', () => {
  it('collects images from featured image, images array, and inline body HTML', async () => {
    const { shopifyProductToWoo } = await import('../../src/adapters/shopify/index.js');
    const fixture = JSON.parse(readFileSync('test/fixtures/shopify-product.json', 'utf8'));
    const { parent } = shopifyProductToWoo(fixture.product);

    // Featured image first
    expect(parent.images?.[0]).toBe('https://cdn.shopify.com/s/files/1/featured-ring.jpg');
    // Images array
    expect(parent.images).toContain('https://cdn.shopify.com/s/files/1/ring-front.jpg');
    expect(parent.images).toContain('https://cdn.shopify.com/s/files/1/ring-side.jpg');
    // Inline HTML image
    expect(parent.images).toContain('https://cdn.shopify.com/s/files/1/inline-ring.jpg');
    // No duplicates
    expect(parent.images?.length).toBe(new Set(parent.images).size);
    // Total: featured + 2 from images array + 1 inline = 4
    expect(parent.images?.length).toBe(4);
  });

  it('deduplicates when featured image is also in images array', async () => {
    const { shopifyProductToWoo } = await import('../../src/adapters/shopify/index.js');
    const product = {
      title: 'Test',
      handle: 'test',
      body_html: '',
      image: { src: 'https://cdn.shopify.com/s/files/1/same.jpg' },
      images: [
        { src: 'https://cdn.shopify.com/s/files/1/same.jpg' },
        { src: 'https://cdn.shopify.com/s/files/1/other.jpg' },
      ],
      variants: [{ title: 'Default', price: '10.00', sku: 'SKU-1' }],
      options: [{ name: 'Title', values: ['Default'] }],
    };
    const { parent } = shopifyProductToWoo(product);
    const sameCount = parent.images?.filter(
      (img) => img === 'https://cdn.shopify.com/s/files/1/same.jpg'
    ).length;
    expect(sameCount).toBe(1);
    expect(parent.images?.length).toBe(2);
  });

  it('returns variation rows for variable products', async () => {
    const { shopifyProductToWoo } = await import('../../src/adapters/shopify/index.js');
    const fixture = JSON.parse(readFileSync('test/fixtures/shopify-product.json', 'utf8'));
    const { parent, variations } = shopifyProductToWoo(fixture.product);

    expect(parent.type).toBe('variable');
    expect(parent.sku).toBe('gothic-silver-ring');
    expect(parent.regularPrice).toBe('');
    expect(variations).toHaveLength(3);

    // Small variant — has compare_at_price
    const small = variations.find((v) => v.sku === 'GSR-S');
    expect(small?.type).toBe('variation');
    expect(small?.parentSku).toBe('gothic-silver-ring');
    expect(small?.regularPrice).toBe('59.99');
    expect(small?.salePrice).toBe('49.99');
    expect(small?.stock).toBe(10);
    expect(small?.inStock).toBe(true);

    // Large variant — no compare_at_price, out of stock
    const large = variations.find((v) => v.sku === 'GSR-L');
    expect(large?.regularPrice).toBe('54.99');
    expect(large?.salePrice).toBeUndefined();
    expect(large?.stock).toBe(0);
    expect(large?.inStock).toBe(false);

    // Attributes on variations contain single-value entries
    const mediumAttr = variations.find((v) => v.sku === 'GSR-M')?.attributes?.[0];
    expect(mediumAttr?.values).toEqual(['M']);
  });

  it('returns empty variations for simple products', async () => {
    const { shopifyProductToWoo } = await import('../../src/adapters/shopify/index.js');
    const product = {
      title: 'Simple Candle',
      handle: 'simple-candle',
      body_html: '<p>A nice candle.</p>',
      variants: [{ title: 'Default Title', price: '25.00', sku: 'SC-1', available: true, inventory_quantity: 3 }],
      options: [{ name: 'Title', values: ['Default Title'] }],
    };
    const { parent, variations } = shopifyProductToWoo(product);
    expect(parent.type).toBe('simple');
    expect(variations).toHaveLength(0);
  });
});

describe('scorePageQuality', () => {
  it('scores high for page with title, long content, images, and date', async () => {
    const { scorePageQuality } = await import('../../src/adapters/shopify/index.js');
    // title=20, content>200=25, images=15, structuredData=10, date=10 → 80 → high
    const result = scorePageQuality({
      title: 'My Page',
      content: 'a'.repeat(250),
      images: ['https://cdn.shopify.com/image.jpg'],
      date: '2026-01-15T10:00:00-05:00',
      hasStructuredData: true,
      hasPriceSku: false,
    });
    expect(result).toBe('high');
  });

  it('scores medium for page with title and short content', async () => {
    const { scorePageQuality } = await import('../../src/adapters/shopify/index.js');
    // title=20, content 50-200=10 → 30 → medium
    const result = scorePageQuality({
      title: 'My Page',
      content: 'a'.repeat(100),
      images: [],
      date: '',
      hasStructuredData: false,
      hasPriceSku: false,
    });
    expect(result).toBe('medium');
  });

  it('scores low for page with only a title', async () => {
    const { scorePageQuality } = await import('../../src/adapters/shopify/index.js');
    // title=20 → 20 → low
    const result = scorePageQuality({
      title: 'My Page',
      content: '',
      images: [],
      date: '',
      hasStructuredData: false,
      hasPriceSku: false,
    });
    expect(result).toBe('low');
  });

  it('includes price/SKU bonus for products', async () => {
    const { scorePageQuality } = await import('../../src/adapters/shopify/index.js');
    // title=20, content 50-200=10, images=15, hasPriceSku=10 → 55 → high
    const result = scorePageQuality({
      title: 'My Product',
      content: 'a'.repeat(60),
      images: ['https://cdn.shopify.com/image.jpg'],
      date: '',
      hasStructuredData: false,
      hasPriceSku: true,
    });
    expect(result).toBe('high');
  });
});
