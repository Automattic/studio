// src/lib/replicate/embed-block.ts
//
// Shared, platform-agnostic embed helpers. Given a URL, identify the oEmbed
// provider and emit native `core/embed` block markup. Used by BOTH the
// Squarespace adapter recipe (`adapters/squarespace/blocks.ts`) and the generic
// block catalog (`generic-block-catalog.ts`, iframe -> embed), so provider
// coverage and block markup live in exactly one place.

type EmbedType = 'video' | 'rich';

interface ProviderDef {
  slug: string;
  type: EmbedType;
  match: RegExp;
}

// Recognised oEmbed providers. `video` providers get the 16:9 aspect-ratio
// classes WordPress applies to fixed-ratio video embeds; `rich` providers
// (social posts, audio) size themselves and get no aspect classes.
const PROVIDERS: ProviderDef[] = [
  { slug: 'youtube', type: 'video', match: /youtube\.com|youtu\.be/i },
  { slug: 'vimeo', type: 'video', match: /vimeo\.com/i },
  { slug: 'dailymotion', type: 'video', match: /dailymotion\.com|dai\.ly/i },
  { slug: 'twitter', type: 'rich', match: /twitter\.com|x\.com/i },
  { slug: 'instagram', type: 'rich', match: /instagram\.com/i },
  { slug: 'facebook', type: 'rich', match: /facebook\.com|fb\.watch/i },
  { slug: 'tiktok', type: 'rich', match: /tiktok\.com/i },
  { slug: 'soundcloud', type: 'rich', match: /soundcloud\.com/i },
  { slug: 'spotify', type: 'rich', match: /spotify\.com/i },
];

function providerDef(url: string): ProviderDef | null {
  for (const p of PROVIDERS) {
    if (p.match.test(url)) return p;
  }
  return null;
}

/** Identify the oEmbed provider slug for a URL, or null when unrecognised. */
export function guessEmbedProvider(url: string): string | null {
  return providerDef(url)?.slug ?? null;
}

/**
 * Build native `core/embed` block markup for a URL. When the provider is known,
 * the block carries its `type`/`providerNameSlug` and (for video) 16:9 aspect
 * classes. An unknown URL still produces a valid, responsive embed block with no
 * provider hint — a lossless upgrade over leaving a raw iframe in a core/html
 * island.
 *
 * The URL sits inside the block-comment JSON, so it is JSON-escaped (NOT
 * HTML-escaped): `escapeAttr` would turn `?a=1&b=2` into `&amp;`, which
 * `json_decode` reads literally and breaks oEmbed resolution. `JSON.stringify`
 * emits the surrounding quotes.
 */
export function buildEmbedBlock(url: string): string {
  const def = providerDef(url);
  const isVideo = def?.type === 'video';

  const attrParts = [`"url":${JSON.stringify(url)}`];
  if (def) attrParts.push(`"type":"${def.type}"`);
  if (def) attrParts.push(`"providerNameSlug":"${def.slug}"`);
  attrParts.push('"responsive":true');
  const attrs = `{${attrParts.join(',')}}`;

  const providerClasses = def ? ` is-provider-${def.slug} wp-block-embed-${def.slug}` : '';
  const aspectClasses = isVideo ? ' wp-embed-aspect-16-9 wp-has-aspect-ratio' : '';

  return (
    `<!-- wp:embed ${attrs} -->\n` +
    `<figure class="wp-block-embed${providerClasses}${aspectClasses}">` +
    `<div class="wp-block-embed__wrapper">\n${url}\n</div></figure>\n` +
    `<!-- /wp:embed -->`
  );
}
