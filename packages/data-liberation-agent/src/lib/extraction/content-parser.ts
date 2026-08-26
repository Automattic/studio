import * as cheerio from 'cheerio';

export interface ContentModel {
  text: string;
  headings: Array<{ level: number; text: string }>;
  images: Array<{ src: string; alt: string }>;
  links: Array<{ href: string; text: string }>;
}

/**
 * Parse HTML into a content model.
 * When `scopeToContent` is true, tries to narrow to the main content area
 * (stripping site chrome like nav, header, footer, sidebar) before extracting.
 */
export function parseContent(html: string, scopeToContent = false): ContentModel {
  if (!html) {
    return { text: '', headings: [], images: [], links: [] };
  }

  const $ = cheerio.load(html);
  $('script, style').remove();

  if (scopeToContent) {
    // Remove common site chrome elements before extracting
    $('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]').remove();
    // Squarespace-specific chrome
    $('.header, .footer, .site-navigation, #header, #footer, #navigation').remove();

    // Try to scope to main content container
    const contentSelectors = [
      'main article',
      'article',
      'main',
      '[role="main"]',
      '.blog-item-content',        // Squarespace blog
      '.entry-content',            // common WP/blog pattern
      '.sqs-block-content',        // Squarespace blocks
      '.page-content',
    ];
    for (const sel of contentSelectors) {
      const $scoped = $(sel);
      if ($scoped.length > 0 && $scoped.text().trim().length > 100) {
        // Replace body content with just the scoped content
        $('body').html($scoped.html() || '');
        break;
      }
    }
  }

  const headings: ContentModel['headings'] = [];
  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    const tagName = (el as any).tagName.toLowerCase();
    headings.push({
      level: parseInt(tagName[1], 10),
      text: $(el).text().trim(),
    });
  });

  const images: ContentModel['images'] = [];
  $('img[src]').each((_, el) => {
    images.push({
      src: $(el).attr('src') || '',
      alt: $(el).attr('alt') || '',
    });
  });

  const links: ContentModel['links'] = [];
  $('a').each((_, el) => {
    links.push({
      href: $(el).attr('href') || '',
      text: $(el).text().trim(),
    });
  });

  // Insert spaces before block-level elements so adjacent blocks don't merge
  $('p,div,li,ul,ol,br,h1,h2,h3,h4,h5,h6,blockquote,section,article,header,footer,nav,main,aside,figure,figcaption,table,tr,td,th,thead,tbody,tfoot,dt,dd,dl').before(' ');
  const text = $.root().text().replace(/\s+/g, ' ').trim();

  return { text, headings, images, links };
}
