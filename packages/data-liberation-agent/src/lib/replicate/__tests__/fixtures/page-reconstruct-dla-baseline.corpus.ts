import type { ReconstructOptions } from '../../page-reconstruct.js';
import type {
  InteractionModel,
  SectionSpec,
  SectionSpecButton,
  SectionSpecCell,
  SectionSpecForm,
  SectionSpecImage,
} from '../../section-extract.js';

export interface FrozenConvertedSection {
  sectionIndex: number;
  markup: string | null;
  wpHtmlResidue: number;
}

export interface FrozenReconstructOptions extends Omit<ReconstructOptions, 'convertedSections' | 'adapterBlocks'> {
  convertedSections?: FrozenConvertedSection[];
}

export interface FrozenReconstructCase {
  id: string;
  sections: SectionSpec[];
  options: FrozenReconstructOptions;
}

const WP = 'http://localhost:8883/wp-content/uploads/2026/05/';
const CDN = 'https://cdn.example.test/assets/';

const contactForm: SectionSpecForm = {
  fields: [
    { kind: 'name', label: 'Full name', required: true, widthPct: 50 },
    { kind: 'email', label: 'Email address', required: true, widthPct: 50 },
    { kind: 'select', label: 'Topic', required: false, options: ['Billing', 'Support'] },
    { kind: 'textarea', label: 'Message', required: false },
    { kind: 'hidden', label: 'Campaign id', required: false },
  ],
  submitLabel: 'Send Message',
};

function options(id: string, partial: Partial<FrozenReconstructOptions> = {}): FrozenReconstructOptions {
  return {
    patternSlug: `baseline/${id}`,
    title: `Baseline ${id}`,
    slug: id,
    sourceUrl: `https://example.test/${id}`,
    ...partial,
  };
}

function image(name: string, width = 800, height = 600, alt = name): SectionSpecImage {
  return {
    url: `${WP}${name}`,
    sourceUrl: `${CDN}${name}`,
    alt,
    kind: 'img',
    width,
    height,
  };
}

function remoteImage(name: string, width = 800, height = 600): SectionSpecImage {
  return {
    url: `${CDN}${name}`,
    sourceUrl: `${CDN}${name}`,
    alt: name,
    kind: 'img',
    width,
    height,
  };
}

function button(label: string, href = '#'): SectionSpecButton {
  return { label, href, background: null, color: null };
}

function cell(partial: Partial<SectionSpecCell>): SectionSpecCell {
  return {
    heading: null,
    body: [],
    image: null,
    icon: null,
    button: null,
    ...partial,
  };
}

function section(
  sectionIndex: number,
  interactionModel: InteractionModel,
  partial: Partial<SectionSpec> = {},
): SectionSpec {
  return {
    sectionIndex,
    interactionModel,
    top: sectionIndex * 500,
    height: 420,
    headings: [],
    bodyText: [],
    buttonLabels: [],
    images: [],
    icons: [],
    backgroundBrightness: 255,
    backgroundColor: 'rgb(255, 255, 255)',
    gradient: null,
    gradientSource: null,
    motionProfile: { motionClass: 'none', signals: [], animatedElements: 0 },
    dividerAbove: null,
    dividerBelow: null,
    layout: { containerWidth: 1200, padding: '0', childLayout: 'stack', columnCount: 1, gap: '24px' },
    ...partial,
  } as SectionSpec;
}

function converted(markup: string | null, wpHtmlResidue = 0, sectionIndex = 0): FrozenConvertedSection[] {
  return [{ sectionIndex, markup, wpHtmlResidue }];
}

export const reconstructBaselineCases: FrozenReconstructCase[] = [
  {
    id: 'converted-accept',
    sections: [section(0, 'static', { headings: ['Converted Heading'], bodyText: ['Converted body copy'] })],
    options: options('converted-accept', {
      convertedSections: converted(
        '<!-- wp:heading --><h2>Converted Heading</h2><!-- /wp:heading -->\n' +
          '<!-- wp:paragraph --><p>Converted body copy</p><!-- /wp:paragraph -->',
      ),
    }),
  },
  {
    id: 'converted-reject-residue',
    sections: [section(0, 'static', { headings: ['Residue Heading'], bodyText: ['Structured render survives'] })],
    options: options('converted-reject-residue', {
      convertedSections: converted('<!-- wp:html --><div>unconverted residue</div><!-- /wp:html -->', 1),
    }),
  },
  {
    id: 'converted-reject-remote-asset',
    sections: [section(0, 'static', { headings: ['Remote Photo'], images: [remoteImage('remote-photo.jpg')] })],
    options: options('converted-reject-remote-asset', {
      convertedSections: converted(
        '<!-- wp:heading --><h2>Remote Photo</h2><!-- /wp:heading -->\n' +
          '<!-- wp:image --><figure class="wp-block-image"><img src="https://cdn.example.test/assets/remote-photo.jpg" alt=""/></figure><!-- /wp:image -->',
      ),
    }),
  },
  {
    id: 'converted-reject-placeholder',
    sections: [section(0, 'static', { headings: ['Template Token'], bodyText: ['Token body'] })],
    options: options('converted-reject-placeholder', {
      convertedSections: converted(
        '<!-- wp:heading --><h2>Template Token</h2><!-- /wp:heading -->\n' +
          '<!-- wp:paragraph --><p>Hello {{ visitor }}</p><!-- /wp:paragraph -->',
      ),
    }),
  },
  {
    id: 'converted-reject-injection',
    sections: [section(0, 'static', { headings: ['Injected Section'], bodyText: ['Clean body'] })],
    options: options('converted-reject-injection', {
      convertedSections: converted(
        '<!-- wp:heading --><h2 onclick="alert(1)">Injected Section</h2><!-- /wp:heading -->\n' +
          '<!-- wp:paragraph --><p>Clean body</p><!-- /wp:paragraph -->',
      ),
    }),
  },
  {
    id: 'converted-reject-coverage-loss',
    sections: [section(0, 'static', { headings: ['Coverage Heading'], bodyText: ['Required body copy'] })],
    options: options('converted-reject-coverage-loss', {
      convertedSections: converted('<!-- wp:heading --><h2>Coverage Heading</h2><!-- /wp:heading -->'),
    }),
  },
  {
    id: 'static-text-band',
    sections: [section(0, 'static', { headings: ['Static Band'], bodyText: ['Plain section copy'], buttonLabels: ['Read More'] })],
    options: options('static-text-band'),
  },
  {
    id: 'cta-text-band',
    sections: [section(0, 'cta', { headings: ['Start Today'], bodyText: ['A compact call to action.'], buttons: [button('Contact Us', '/contact')] })],
    options: options('cta-text-band'),
  },
  {
    id: 'price-list-text-band',
    sections: [section(0, 'price-list', { headings: ['Service Menu'], bodyText: ['Consulting 100', 'Implementation 250'] })],
    options: options('price-list-text-band'),
  },
  {
    id: 'app-download-text-band',
    sections: [section(0, 'app-download', { headings: ['Get the App'], bodyText: ['Download the fictional app today.'], images: [image('app-badge.png', 220, 70)] })],
    options: options('app-download-text-band'),
  },
  {
    id: 'horizontal-showcase-text-band',
    sections: [section(0, 'horizontal-showcase', { headings: ['Featured Work'], bodyText: ['A scrolling showcase without JS.'] })],
    options: options('horizontal-showcase-text-band'),
  },
  {
    id: 'cover-with-headline-cover',
    sections: [
      section(0, 'cover-with-headline', {
        headings: ['Wide Cover Hero'],
        bodyText: ['Text over a full bleed image.'],
        images: [image('wide-cover.jpg', 1400, 700)],
        fullBleed: true,
        backgroundBrightness: 24,
        backgroundColor: 'rgb(20, 20, 20)',
      }),
    ],
    options: options('cover-with-headline-cover'),
  },
  {
    id: 'cover-with-headline-media-text',
    sections: [section(0, 'cover-with-headline', { headings: ['Side Hero'], bodyText: ['Photo beside text.'], images: [image('side-hero.jpg', 800, 600)] })],
    options: options('cover-with-headline-media-text'),
  },
  {
    id: 'animated-cover-cover',
    sections: [section(0, 'animated-cover', { headings: ['Animated Cover'], bodyText: ['Motion-free frozen baseline.'], images: [image('animated-cover.jpg', 1500, 820)] })],
    options: options('animated-cover-cover'),
  },
  {
    id: 'media-text-alternating',
    sections: [section(0, 'media-text', { headings: ['Media Text'], bodyText: ['Copy paired with a lead image.'], images: [image('media-text.jpg')] })],
    options: options('media-text-alternating'),
  },
  {
    id: 'columns-media-text',
    sections: [section(0, 'columns', { headings: ['Column Story'], bodyText: ['One image in columns routes to media text.'], images: [image('columns-photo.jpg')] })],
    options: options('columns-media-text'),
  },
  {
    id: 'columns-cell-grid',
    sections: [
      section(0, 'columns', {
        headings: ['Feature Columns'],
        layout: { containerWidth: 1200, padding: '0', childLayout: 'grid', columnCount: 3, gap: '32px' },
        cells: [
          cell({ heading: 'Plan', body: ['Define the fictional goal.'], icon: { kind: 'glyph', glyph: '*', fontFamily: 'serif', width: 24, height: 24 } }),
          cell({ heading: 'Build', body: ['Assemble the deterministic pieces.'] }),
          cell({ heading: 'Ship', body: ['Verify the final artifact.'], button: 'Launch' }),
        ],
      }),
    ],
    options: options('columns-cell-grid'),
  },
  {
    id: 'gallery-image-row',
    sections: [section(0, 'gallery', { headings: ['Gallery'], images: [image('gallery-1.jpg'), image('gallery-2.jpg'), image('gallery-3.jpg')] })],
    options: options('gallery-image-row'),
  },
  {
    id: 'logo-strip-image-row',
    sections: [section(0, 'logo-strip', { headings: ['Partners'], images: [image('logo-1.png', 180, 90), image('logo-2.png', 180, 90), image('logo-3.png', 180, 90)] })],
    options: options('logo-strip-image-row'),
  },
  {
    id: 'marquee-strip-image-row',
    sections: [section(0, 'marquee-strip', { headings: ['Marquee'], images: [image('marquee-1.jpg'), image('marquee-2.jpg'), image('marquee-3.jpg')] })],
    options: options('marquee-strip-image-row'),
  },
  {
    id: 'color-block-grid-image-row',
    sections: [section(0, 'color-block-grid', { headings: ['Color Blocks'], images: [image('color-1.jpg'), image('color-2.jpg'), image('color-3.jpg')] })],
    options: options('color-block-grid-image-row'),
  },
  {
    id: 'product-card-row',
    sections: [section(0, 'product-card-row', { headings: ['Shop Products', 'Pillow', 'Blanket'], bodyText: ['$20', '$40'], images: [image('pillow.jpg'), image('blanket.jpg')], buttonLabels: ['Buy Pillow', 'Buy Blanket'] })],
    options: options('product-card-row'),
  },
  {
    id: 'project-card-grid',
    sections: [section(0, 'project-card-grid', { headings: ['Projects', 'Atrium', 'Lobby'], bodyText: ['Glass renovation', 'Stone refresh'], images: [image('atrium.jpg'), image('lobby.jpg')] })],
    options: options('project-card-grid'),
  },
  {
    id: 'blog-card-grid',
    sections: [section(0, 'blog-card-grid', { headings: ['Latest Notes', 'Launch Recap', 'Design Review'], bodyText: ['What changed', 'What we learned'], images: [image('post-1.jpg'), image('post-2.jpg')] })],
    options: options('blog-card-grid'),
  },
  {
    id: 'testimonial-review-grid',
    sections: [section(0, 'testimonial', { headings: ['Customers'], reviews: [{ category: 'Service', stars: 5, quote: 'They kept every promise.', author: 'A. Customer' }] })],
    options: options('testimonial-review-grid'),
  },
  {
    id: 'review-grid',
    sections: [
      section(0, 'review-grid', {
        headings: ['Reviews'],
        reviews: [
          { category: 'Support', stars: 5, quote: 'Fast fictional support.', author: 'Morgan' },
          { category: 'Quality', stars: 4, quote: 'Reliable fictional quality.', author: 'Casey' },
        ],
      }),
    ],
    options: options('review-grid'),
  },
  {
    id: 'faq-details',
    sections: [section(0, 'static', { headings: ['FAQ'], faqs: [{ question: 'Do you ship?', answer: 'We ship fictional orders daily.' }] })],
    options: options('faq-details'),
  },
  {
    id: 'heading-echo-entities',
    sections: [
      section(0, 'static', {
        headings: ['Food & Drink'],
        bodyText: ['Food & Drink', 'Reservations open tonight.'],
        sectionHtml: '<section><p class="headline">Food &amp; Drink</p><p>Reservations open tonight.</p></section>',
      }),
    ],
    options: options('heading-echo-entities'),
  },
  {
    id: 'missing-image-placeholder',
    sections: [section(0, 'static', { headings: ['Remote Missing'], images: [remoteImage('missing-photo.jpg')] })],
    options: options('missing-image-placeholder'),
  },
  {
    id: 'recoverable-image-append',
    sections: [
      section(0, 'columns', {
        headings: ['Recoverable Media'],
        images: [image('recoverable.jpg', 900, 700)],
        layout: { containerWidth: 1200, padding: '0', childLayout: 'grid', columnCount: 2, gap: '24px' },
        cells: [
          cell({ heading: 'One', body: ['First card body.'] }),
          cell({ heading: 'Two', body: ['Second card body.'] }),
        ],
      }),
    ],
    options: options('recoverable-image-append'),
  },
  {
    id: 'styled-island-tier',
    sections: [
      section(0, 'static', {
        headings: ['Styled Island'],
        images: [remoteImage('styled-loss.jpg')],
        sectionHtml: '<section class="source-only"><h2>Styled Island</h2><img src="https://cdn.example.test/assets/styled-loss.jpg"></section>',
        styledHtml: '<section style="display:grid;gap:12px"><h2>Styled Island</h2><img src="https://cdn.example.test/assets/styled-loss.jpg"></section>',
      }),
    ],
    options: options('styled-island-tier'),
  },
  {
    id: 'responsive-island-tier',
    sections: [
      section(0, 'static', {
        headings: ['Responsive Island'],
        images: [remoteImage('responsive-loss.jpg')],
        sectionHtml: '<section class="wp-block-group is-layout-constrained"><h2>Responsive Island</h2><img src="https://cdn.example.test/assets/responsive-loss.jpg"></section>',
        styledHtml: '<section style="width:1200px"><h2>Responsive Island</h2><img src="https://cdn.example.test/assets/responsive-loss.jpg"></section>',
      }),
    ],
    options: options('responsive-island-tier'),
  },
  {
    id: 'form-jetpack-append',
    sections: [section(0, 'static', { headings: ['Get in Touch'], bodyText: ['Send a fictional note.'], forms: [contactForm] })],
    options: options('form-jetpack-append'),
  },
  {
    id: 'form-island-no-jetpack',
    sections: [
      section(0, 'static', {
        headings: ['Contact Island'],
        images: [remoteImage('form-fallback.jpg')],
        forms: [contactForm],
        sectionHtml: '<section><h2>Contact Island</h2><form><input type="email"></form><img src="https://cdn.example.test/assets/form-fallback.jpg"></section>',
      }),
    ],
    options: options('form-island-no-jetpack'),
  },
  {
    id: 'chrome-strip-nav-footer',
    sections: [
      section(0, 'nav', { headings: ['Site Nav'], bodyText: ['Home', 'About', 'Contact'], height: 80 }),
      section(1, 'static', { headings: ['Body Section'], bodyText: ['The real page body.'] }),
      section(2, 'footer', { headings: ['Shop', 'Support', 'Company'], bodyText: ['Copyright 2026 Example'] }),
    ],
    options: options('chrome-strip-nav-footer'),
  },
];
