export interface PlatformFeature {
  id: string;
  name: string;
  detected: boolean;
  transferable: boolean;
  wpRecommendation: string;
}

interface FeatureRule {
  id: string;
  name: string;
  urlPatterns: RegExp[];
  htmlMarkers: RegExp[];
  platforms: string[];
  transferable: boolean;
  wpRecommendation: string;
}

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
    ],
    htmlMarkers: [
      /data-hook="product-/i,
      /sqs-block-summary/i,
      /class="product-/i,
      /shopify-section/i,
      /w-commerce/i,
    ],
    platforms: ['shopify', 'squarespace', 'webflow', 'wix'],
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
    ],
    htmlMarkers: [
      /data-hook="booking/i,
      /wix-bookings/i,
    ],
    platforms: ['wix'],
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
    ],
    platforms: ['squarespace', 'webflow', 'wix'],
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
    ],
    platforms: ['squarespace', 'wix'],
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
    ],
    platforms: ['wix'],
    transferable: false,
    wpRecommendation: 'bbPress or BuddyPress plugin',
  },
  {
    id: 'events',
    name: 'Events',
    urlPatterns: [
      /\/events\//i,
      /\/event\//i,
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

      return {
        id: rule.id,
        name: rule.name,
        detected: urlMatch || htmlMatch,
        transferable: rule.transferable,
        wpRecommendation: rule.wpRecommendation,
      };
    });
}
