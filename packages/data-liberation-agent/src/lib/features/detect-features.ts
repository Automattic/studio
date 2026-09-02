export interface PlatformFeature {
  id: string;
  name: string;
  detected: boolean;
  transferable: boolean;
  wpRecommendation: string;
  /** Which signals fired. Empty when not detected. Lets triage weigh a URL-only hit against a markup hit. */
  evidence: FeatureEvidence[];
}

export type FeatureEvidence = 'url' | 'html';

interface FeatureRule {
  id: string;
  name: string;
  urlPatterns: RegExp[];
  htmlMarkers: RegExp[];
  platforms: string[];
  transferable: boolean;
  wpRecommendation: string;
}

// Detection notes
// ---------------
// Each rule has two independent signals:
//   - urlPatterns: cheap, from the sitemap. Only as good as the owner's slugs —
//     a renamed page is missed, a brochure page called "Events" is a false
//     positive. Treat as a hint.
//   - htmlMarkers: the platform's own component markup (data-hooks, widget
//     classes, app scripts). Independent of slugs, and the only way to see
//     features that live as widgets with no page of their own (forms, chat,
//     login bars, a bookings widget on the homepage). Treat as confirmation.
// Callers must pass sampled page HTML (at minimum the homepage) or the second
// signal never runs; see handlers/inspect.ts.
//
// Weebly markers use Weebly's `wsite-*` class namespace (`wsite-com-*` for
// Commerce, `wsite-form*` for forms). Markers tagged VERIFY were written from
// documentation and memory and need checking against a live Weebly site of
// that kind before this ships.

const FEATURE_RULES: FeatureRule[] = [
  {
    id: 'store',
    name: 'Online Store / E-commerce',
    urlPatterns: [
      /\/product-page\//i,
      /\/store\//i,
      /\/shop\//i,
      /\/products\//i,
      /\/collections\//i,
      /\/cart/i,
      /\/store\/[cp]\d+\//i, // Weebly: /store/c1/Category.html, /store/p12/Product.html
    ],
    htmlMarkers: [
      /data-hook="product-/i,
      /sqs-block-summary/i,
      /class="product-/i,
      /shopify-section/i,
      /w-commerce/i,
      /wsite-com-/i, // Weebly Commerce: wsite-com-category-product, wsite-com-product-*
      /wsite-product/i, // Weebly product element (VERIFY)
    ],
    platforms: ['shopify', 'squarespace', 'webflow', 'wix', 'weebly'],
    transferable: true,
    wpRecommendation: 'Products are exported as WooCommerce-compatible CSV during extraction',
  },
  {
    id: 'bookings',
    name: 'Bookings / Appointments',
    urlPatterns: [
      /\/booking-calendar\//i,
      /\/bookings-checkout\//i,
      /\/book-online/i,
      /\/service-page\//i, // Wix Bookings individual service pages
    ],
    htmlMarkers: [
      /data-hook="booking/i,
      /wix-bookings/i,
      /bookings-widget/i,
      /appointedd|10to8\.com|acuityscheduling\.com\/schedule/i, // Weebly App Center schedulers and Acuity embeds
    ],
    platforms: ['wix', 'weebly'],
    transferable: false,
    wpRecommendation: 'Amelia or Simply Schedule Appointments plugin',
  },
  {
    id: 'forms',
    name: 'Forms',
    urlPatterns: [],
    htmlMarkers: [
      /data-mesh-id="comp-form/i,
      /wix-form/i,
      /sqs-block-form/i,
      /class="w-form"/i,
      /data-hook="form/i,
      /wsite-form/i, // Weebly Contact/Newsletter/RSVP/Survey elements: wsite-form-container, wsite-form-input-*
      /formwrapper|wsite-form-field/i, // Weebly legacy form wrappers (VERIFY)
    ],
    platforms: ['squarespace', 'webflow', 'wix', 'weebly'],
    transferable: false,
    wpRecommendation: 'Jetpack Forms (auto-installed when forms are detected)',
  },
  {
    id: 'members',
    name: 'Members Area / User Accounts',
    urlPatterns: [
      /\/members-area\//i,
      /\/account\//i,
      /\/my-account/i,
    ],
    htmlMarkers: [
      /data-hook="members/i,
      /wix-members/i,
      /wsite-nav-login|wsite-login|wsite-member/i, // Weebly member login link / member-only pages (VERIFY)
    ],
    platforms: ['squarespace', 'wix', 'weebly'],
    transferable: false,
    wpRecommendation: 'MemberPress or Paid Memberships Pro plugin',
  },
  {
    id: 'scheduling',
    name: 'Scheduling / Appointments',
    urlPatterns: [],
    htmlMarkers: [
      /sqs-block-schedulingblock/i,
      /acuity-embed/i,
    ],
    platforms: ['squarespace'],
    transferable: false,
    wpRecommendation: 'Amelia or Simply Schedule Appointments plugin',
  },
  {
    id: 'forum',
    name: 'Forum / Community',
    urlPatterns: [
      /\/forum\//i,
    ],
    htmlMarkers: [
      /data-hook="forum/i,
      /wix-forum/i,
      /wsite-forum|weebly-forum/i, // Weebly Forum element (VERIFY)
    ],
    platforms: ['wix', 'weebly'],
    transferable: false,
    wpRecommendation: 'bbPress or BuddyPress plugin',
  },
  {
    id: 'events',
    name: 'Events',
    urlPatterns: [
      /\/events\//i,
      /\/event\//i,
      /\/event-details\//i, // Wix Events individual event pages
    ],
    htmlMarkers: [
      /data-hook="events/i,
      /wix-events/i,
      /sqs-block-summary.*event/i,
    ],
    platforms: ['squarespace', 'wix'],
    transferable: false,
    wpRecommendation: 'The Events Calendar plugin',
  },
  // --- New rules. Each of these changes the DIFM triage verdict (plugin route
  // vs. agency referral), so triage needs to see them in the report.
  {
    id: 'restaurants',
    name: 'Restaurant Menus / Online Ordering / Reservations',
    urlPatterns: [
      /\/online-ordering/i,
      /\/order-online/i,
      /\/table-reservations?/i,
      /\/restaurant-menu/i,
    ],
    htmlMarkers: [
      /wix-restaurants/i,
      /wixrestaurants/i,
      /data-hook="restaurants/i,
      /data-hook="menus-/i,
      /table-reservations-widget/i,
    ],
    platforms: ['wix'],
    transferable: false,
    wpRecommendation:
      'Menus rebuild as block patterns. Online ordering and reservations need WooCommerce with a food-ordering extension or OpenTable/Resy embeds — usually an agency referral',
  },
  {
    id: 'pricing-plans',
    name: 'Pricing Plans / Paid Memberships',
    urlPatterns: [
      /\/plans-pricing/i,
      /\/pricing-plans/i,
    ],
    htmlMarkers: [
      /wix-pricing-plans/i,
      /data-hook="pricing-plans/i,
      /data-hook="plan-/i,
    ],
    platforms: ['wix'],
    transferable: false,
    wpRecommendation:
      'Recurring payments and gated content via the WordPress.com Payments and Paid Content blocks; gating bookings, groups or services behind a plan needs MemberPress or Paid Memberships Pro',
  },
  {
    id: 'multilingual',
    name: 'Multilingual Site',
    urlPatterns: [
      // Language-prefixed paths like /es/about or /fr-ca/contact. Limited to
      // common ISO 639-1 codes so two-letter section slugs don't trip it.
      /^https?:\/\/[^/]+\/(en|es|fr|de|it|pt|nl|ru|ja|zh|ko|ar|he|pl|sv|da|nb|no|fi|tr|cs|el|hu|ro|uk|th|vi|id|ms)(-[a-z]{2})?\/[^/]+/i,
    ],
    htmlMarkers: [
      /wix-multilingual|wixMultilingual/i,
      /data-hook="language-selector/i,
      /conveythis|linguise|weglot|gtranslate/i, // Translator apps used on Weebly / Squarespace / Webflow
    ],
    platforms: ['wix', 'weebly', 'squarespace', 'webflow'],
    transferable: false,
    wpRecommendation:
      'WPML, Polylang or TranslatePress on Business+. Translations are not extracted; estimate roughly one rebuild per language',
  },
  {
    id: 'cms',
    name: 'CMS Collections / Dynamic Pages / Custom Code',
    urlPatterns: [],
    htmlMarkers: [
      /wix-code-sdk|wixCodeEmbeds|wix-code-/i, // Velo runtime on the page
      /data-hook="dynamic-page/i,
      /"dynamicPage"|dynamic_page/i,
      /wixDataCollection|wix-data-/i,
    ],
    platforms: ['wix'],
    transferable: false,
    wpRecommendation:
      'Dynamic pages map to a custom post type with Query Loop; custom fields need ACF. Any Velo backend logic is an agency referral',
  },
];

export function detectFeatures(
  platform: string,
  urls: string[],
  htmlSamples: string[]
): PlatformFeature[] {
  const allHtml = htmlSamples.join('\n');

  return FEATURE_RULES
    .filter((rule) => rule.platforms.includes(platform))
    .map((rule) => {
      const urlMatch = urls.some((u) =>
        rule.urlPatterns.some((p) => p.test(u))
      );
      const htmlMatch = rule.htmlMarkers.some((p) => p.test(allHtml));
      const evidence: FeatureEvidence[] = [];
      if (urlMatch) evidence.push('url');
      if (htmlMatch) evidence.push('html');

      return {
        id: rule.id,
        name: rule.name,
        detected: urlMatch || htmlMatch,
        transferable: rule.transferable,
        wpRecommendation: rule.wpRecommendation,
        evidence,
      };
    });
}

/** Number of pages to sample for HTML markers. Homepage plus the first few sitemap URLs. */
export const FEATURE_HTML_SAMPLE_SIZE = 4;

/**
 * Fetch a handful of pages so htmlMarkers have something to match. Failures
 * are swallowed — a missing sample degrades to URL-only detection, it should
 * never abort an inspect.
 */
export async function fetchFeatureHtmlSamples(
  siteUrl: string,
  urls: string[],
  sampleSize = FEATURE_HTML_SAMPLE_SIZE,
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  const normalized = siteUrl.includes('://') ? siteUrl : `https://${siteUrl}`;
  const key = (u: string) => u.replace(/\/+$/, '').toLowerCase();
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const u of [normalized, ...urls]) {
    if (seen.has(key(u))) continue;
    seen.add(key(u));
    candidates.push(u);
    if (candidates.length >= sampleSize) break;
  }
  const samples = await Promise.all(
    candidates.map(async (u) => {
      try {
        const res = await fetchImpl(u, { signal: AbortSignal.timeout(10000), redirect: 'follow' });
        if (!res.ok) return '';
        return await res.text();
      } catch {
        return '';
      }
    })
  );
  return samples.filter(Boolean);
}
