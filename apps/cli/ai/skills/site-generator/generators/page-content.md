You are generating the block-markup BODY for one content page of a WordPress site.

The site's design foundation is already established. The site spec JSON and the chosen design direction are appended after these instructions; a task line at the end gives the page slug, title, and a composition brief. Your output is the post_content body for that single page. This content will be seeded into the live WordPress database via WP-CLI — it is NOT a theme file, and it must NOT be wrapped in any XML, sentinel, or metadata header. Emit raw block-markup HTML and nothing else.

Match the established design exactly. Use the same color slugs, typography, spacing presets, and class conventions the design direction and theme.json define. Do not invent a parallel palette or new font sizes. Let the site spec anchor the tone, the business domain, and any specific details the user mentioned — if the user named real services, products, locations, or language, use them. Do not substitute generic SaaS or consulting filler when the domain is concrete.

## What to produce

Build the page body as 4-7 well-composed top-level sections, in the order the composition brief implies. Each section is a self-contained band with its own rhythm. Do not compose every section from the same kit — vary archetype, alignment, and what carries the weight (image, typography, color band, or whitespace) section to section. A page where every band is a centered heading-plus-paragraph reads as a template, not a designed page.

Pick from this section vocabulary, calibrated to the page's role:
- Full-bleed band: an outer `wp:group` (or `wp:cover`) with `"align":"full"` carrying a saturated background color or an edge-to-edge image.
- Asymmetric two-column: `wp:columns` with non-50/50 widths (e.g. `"width":"40%"` / `"width":"60%"`), or `wp:media-text` with `mediaPosition` for an image-beside-text split.
- Card / feature grid: `wp:columns` of equal `wp:column` cards, each an inner `wp:group` with its own background and padding.
- Editorial / centered: a content-width heading and generous prose for manifesto or story sections.
- Zigzag rows: alternating `wp:media-text` blocks that flip `mediaPosition` left/right down the page.
- Photographic strip or quote band: a full-bleed image or a large pull-quote on a colored band.

Calibrate section count to the page: a content page lands at 4-7 bands. An opening section, two to four substantive middle sections, and a closing CTA is a sound default.

## Width and alignment (translate to WordPress mechanics)

Express width with the `align` attribute, never with hand-rolled max-width or horizontal padding wrappers:
- Edge-to-edge background, image strip, full-bleed CTA, full-viewport hero → outer block carries `"align":"full"`.
- A band that extends beyond reading width but not to the viewport edge → `"align":"wide"`.
- Reading-width prose, forms, narrow content → default content width (no `align` attribute).

For a full-bleed band that holds reading-width content, use an `"align":"full"` outer group for the background, with an inner default-width (or `"align":"wide"`) group holding the text. Do not re-emit horizontal padding on the wrapper — root padding is already set in theme.json, and `align` punches through it. Re-padding double-pads the page into a narrow fallback column.

## Block markup rules (apply to every section)

- Prefer core blocks for all content: `wp:group`, `wp:columns`/`wp:column`, `wp:cover`, `wp:media-text`, `wp:heading`, `wp:paragraph`, `wp:image`, `wp:buttons`/`wp:button`, `wp:list`, `wp:quote`, `wp:separator`, `wp:spacer`.
- Put custom class names ONLY on the outermost block of a section, via that block's `"className"` attribute. Never add classes to inner DOM nodes the block serializer generates.
- A full-bleed section is an outer `wp:group` (or `wp:cover`) with `"align":"full"`.
- Whenever a block sets `backgroundColor`, it MUST also set `textColor`. A background without a paired text color produces invisible text on the front end. This applies to every group, column, cover, and button that carries a background.
- A `wp:cover` already darkens its content; still set the text color on the inner heading/paragraph blocks so contrast is explicit.
- Use spacing presets (`var:preset|spacing|NN`) for padding and margins, not raw rem/px values, so the page inherits the design's rhythm.
- No emojis anywhere. No decorative HTML comments — the only comments in your output are WordPress block delimiter comments (`<!-- wp:... -->` / `<!-- /wp:... -->`).

## Imagery

Every image is an `AI_IMAGE` placeholder — you do not have real image URLs. Emit a `wp:image` (or a `wp:cover` whose background is an image) with the src left empty or pointing at a placeholder, and put the generation directive in the `alt` attribute in exactly this shape:

```
alt="AI_IMAGE: short subject description | art-direction style | aspect ratio"
```

For example: `alt="AI_IMAGE: a baker pulling sourdough from a stone oven | warm documentary photography, golden hour | 3:2"`. The downstream image pipeline reads these alt placeholders, generates each asset, and rewrites the src. Make the description concrete and specific to the page's domain; make the style consistent with the design direction's mood; pick an aspect ratio that fits the layout (wide hero `16:9` or `21:9`, portrait card `3:4`, square `1:1`).

## Copy

Write realistic, specific copy — never lorem ipsum, never bracketed `[placeholder]` tokens. Headlines should be concrete and on-brand; body paragraphs should say something real about the business. If the spec gives you facts (offerings, hours, neighborhood, founding story), weave them in. Invent plausible, grounded detail where the spec is silent, in the domain's own register.

## Internal links

When the page links to another page on this site, use a relative href to that page's slug — `href="/<slug>/"` — inside a core `wp:button` or as a plain `<a>` in a `wp:paragraph`. Do not fabricate absolute URLs with a domain, and do not link to slugs that are not real pages on this site (no `/cart/`, `/account/`, `/checkout/` unless the spec lists them). A cross-page CTA looks like:

```
<!-- wp:buttons -->
<div class="wp-block-buttons">
    <!-- wp:button -->
    <div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="/<page-slug>/">Button label</a></div>
    <!-- /wp:button -->
</div>
<!-- /wp:buttons -->
```

Primary site navigation is NOT your concern — it lives in the header template part. Do not emit `wp:navigation` or `wp:navigation-link` in the page body.

## Custom blocks and dynamic content

If the page needs behavior that the site's companion plugin provides — a contact form, a reservation widget, a custom block, or a loop over a custom post type — embed the plugin's block by its slug rather than hand-rolling the markup:

```
<!-- wp:<plugin-prefix>/<block-slug> /-->
```

Use the self-closing form for a block with no inner content, or an opening/closing pair when the block wraps inner blocks. Only reference a block slug the spec actually declares for this site. If no declared block matches a feature that would need JavaScript state or form submission, fall back to a static informational core-block composition rather than inventing a slug — an invented slug renders as broken markup. To surface a collection of custom-post-type entries, use a `wp:query` loop styled with core blocks, never hand-coded entry markup, so editors can add and remove entries without touching this page.

## Scroll motion (hooks only)

Add the class name `reveal-on-scroll` to the outermost block of each substantive section so the companion plugin's progressive-enhancement script can reveal it on scroll. The CSS defines the final visible state and the script adds the initial hidden state, so the page is fully readable with JavaScript disabled, and the effect respects `@media (prefers-reduced-motion: reduce)`. Do not emit any animation CSS or JavaScript here — only the class-name hooks. Do not add reveal hooks to a first-position hero; it is already in view on load.

## First section

If this page opens with a hero against the header, place the hero block first with no top margin and no top padding on its outer block, so it sits flush beneath the header. If the design's header overlays the hero, the first block must be a full-bleed `wp:cover` (or full-bleed image) at least ~80vh tall, with the hero text pushed down by generous top padding so it clears the overlaid header.

Output ONLY the raw file content — no markdown code fences, no commentary, no explanation.
