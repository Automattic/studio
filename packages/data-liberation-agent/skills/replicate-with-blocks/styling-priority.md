# Styling priority — where every style decision goes

Applies to NATIVE block output only. `core/html` fallback islands are verbatim-by-design and exempt. Referenced by: match-section, rebuild-section, compose-page-blocks, replicate-with-blocks.

## The cascade — work top-down, stop at the first fit

1. **A theme.json preset slug** that already matches — `{"backgroundColor":"<slug>"}`, `{"textColor":"<slug>"}`, `{"fontSize":"<slug>"}`, `style.spacing` with `var:preset|spacing|<slug>`. Always prefer a matching preset over a raw value.
2. **Project-wide block styles** — theme.json `styles.blocks["core/<x>"]`. Use when EVERY instance of the block type should look this way (all images rounded, all quotes in the secondary color). Read what's already there first; extend, don't overwrite.
3. **Instance `"style":{...}` JSON in the block comment** — the canonical channel for one-off per-block values (one section's padding, one image's radius). The parser reads it and `save()` renders matching HTML, so validation always holds.
4. **Reuse an existing block style variation** — when the inventory (`<theme>/styles/blocks/*.json`) has an entry whose styles match, apply its `is-style-<slug>` class. NEVER redeclare an existing slug.
5. **A new block style variation** — only when BOTH (a) the same constellation recurs across multiple instances of the block type AND (b) the shape has a coherent identity worth naming in the editor's style switcher ("Filled Card", "Outline Tag"). Slug MUST be `lib-` prefixed. If the honest name is "the padding this one section needed" — that's option 3.
6. **The `layout` block attribute** — for every flex / grid / constrained container: `layout:{"type":"flex","justifyContent":...}`, `layout:{"type":"grid","columnCount":N}`, `layout:{"type":"constrained"}`. Pair with `style.spacing.blockGap` for inter-child gap. NEVER emulate layout with a custom className + CSS rule.
7. **CSS, last resort** — only for rules with no structured equivalent: pseudo-selectors (`:hover`), block-internal descendant selectors (`& img`), animations, `@media` refinements. Three channels, picked by scope: (a) a rule that belongs to a BLOCK TYPE project-wide → theme.json `styles.blocks["core/<x>"].css`; (b) a rule scoped to a named variation → that variation's `styles.css`; (c) a rule scoped to a page/section/selector that isn't a block type (the existing parity workflow) → the theme's `style.css`, scoped, as replicate-with-blocks already instructs. When in doubt between (a) and (c): if a future editor should see the rule attached to the block type, use (a).

## Structured-property cheat sheet — check BEFORE writing CSS

| You want | Use |
| --- | --- |
| aspect ratio | `dimensions.aspectRatio` (core/image, core/cover, core/group, core/post-featured-image) |
| min height | `dimensions.minHeight` |
| gap between children | `style.spacing.blockGap` |
| padding / margin | `style.spacing.padding` / `.margin` (preset refs preferred) |
| borders | `border.radius/color/width/style`, per-side variants |
| shadow / outline | `shadow`, `outline.*` |
| fonts | `typography.fontFamily/Size/Weight/LetterSpacing/LineHeight/TextTransform/...` |
| colors | `color.background/text/gradient` |
| flex / grid / centered | `layout:{...}` block attribute (option 6) |

## Width and alignment

`theme.json.settings.layout.contentSize` / `wideSize` are the project-wide widths. Express width on instances via `align` only: no align = contentSize; `align:"wide"` = wideSize; `align:"full"` = edge-to-edge. Narrower than contentSize → side padding (`style.spacing.padding.left/right`), not a custom width. Per-instance `layout.contentSize`/`wideSize` is a near-forbidden escape hatch — if you reach for it twice on one page, the project-wide values are wrong; fix those instead.

## Hard bans

- **Raw HTML `style="..."` attributes** (including empty `style=""`) on rendered HTML inside native block markup. The parser re-runs `save()` and rejects mismatches ("block contains unexpected or invalid content"). Per-instance values go in the block comment's `"style":{...}` JSON.
  Exception: markup that is NOT round-tripped through the block serializer — static PHP pattern output that bypasses `save()` — may carry an inline style ONLY when no structured attribute exists for the property (e.g. match-section's `object-position` focal-point fix). The ban is about `save()` mismatch; where there is no `save()`, apply judgment and prefer structured channels first.
- **Invented classNames as CSS hooks.** If you want `&.my-made-up-class{...}`, you actually want: a variation (`is-style-lib-<slug>` — registered, not invented), structured properties, or a `layout` attribute. Legal classNames: `is-style-<registered-slug>`, wp-core classes (`alignwide`, `alignfull`), classes the source markup requires for behavior.
- **`wp:html`** — banned project-wide (see `src/lib/wordpress/block-policy.ts`); express visuals structurally instead.
