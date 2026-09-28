---
name: imagery
description: Generate AI images for a site with generate_images — how to write image specs, pick aspect ratios, place files (theme assets vs media library), and handle failures.
user-invokable: true
---

# Site Imagery

Use this skill whenever a design calls for images — hero/cover backgrounds, feature, gallery, or card images, team photos, product shots — and before every `generate_images` call.

## Workflow

1. **Plan all imagery first.** While planning a page or theme, list every image it needs: filename, subject, placement, aspect ratio. Call `generate_images` BEFORE writing the markup that references them: it returns each image's path, attachment ID, and URL at once and generates the images in the background, so write the markup right away.
2. **Pick the destination by where the image is shown**: the file that holds its markup decides, not what the image depicts.
   - **Content imagery**: every image shown by page or post content, including a page's hero or cover, section images, products, team photos, and galleries. Write to `<site>/wp-content/uploads/<name>.png`. The tool adds every image under `wp-content/uploads/` to the media library and reports its attachment ID and URL: use the URL as the `src` and the ID in the block attrs (e.g. `wp:image {"id":<id>,"sizeSlug":"large"}`).
   - **Theme imagery**: only images shown by theme files, meaning a template, a template part such as the header or footer, or `style.css`. Write to `<site>/wp-content/themes/<theme-slug>/assets/images/<name>.png` and reference it in markup as `/wp-content/themes/<theme-slug>/assets/images/<name>.png`. It stays in the theme and never goes into the media library.
   One call can mix both: each image goes where its path says. A one-page site builds its sections in the page content, so its images, hero included, are content imagery.
3. **Batch aggressively.** One `generate_images` call per page (or per site for small sites) with every image in the `images` array — generation is concurrent server-side. Never one call per image. The site's set from the design steps below is the first batch: use it before generating anything else.
4. **Write real alt text.** Generated images are content: give every `<img>` a short, descriptive alt in the markup (what the image shows, for a person who cannot see it). Never leave a spec string or an empty alt on a content image; cover backgrounds keep an empty alt (decorative).

## Writing the spec fields

Every image in the `images` array takes `path`, `subject`, `pageContext`, `style`, `aspectRatio`. The call also takes a shared `siteContext` and `imageGrade`.

### subject — what the image shows

1–3 specific sentences describing ONLY the image itself: what it shows and from what point of view (composition, framing, vantage, mood).

- **NEVER ask the image to render text.** No words, names, letters, numerals, wordmarks, signage copy, or "hand-lettering of <words>" — in any language. Image models garble glyphs and invent fake scripts. Everything meant to be read is real HTML typography styled by the theme. Prefer scenes whose focal subject carries no lettering at all: the model completes any prominent sign, storefront, menu board, or screen with garbled fake text. When a text-bearing surface is unavoidable, describe it as bare (clear glass, an unmarked awning, a blank board) or keep it distant, oblique, or out of focus. Never write words for signage into the subject even to negate them — naming lettering plants it.
- **Describe content and composition, NOT photographic grade.** The site-wide `imageGrade` is applied to every image; do not restate or contradict it per image (no "black and white", "golden hour", "35mm grain" in subjects) — per-image grading makes adjacent images clash.
- Make sibling images in the same section describe distinct subjects so they don't read alike.
- For cover backgrounds with overlaid copy, keep the focal subject off-center with calm, low-detail areas so the overlaid HTML text stays legible.

### pageContext — where the image is used

A short phrase in **pictorial slot language**, in **English** (it is machine guidance, not site copy). Examples: `contained editorial photograph in a 3-column gallery`, `menu item thumbnail`, `full-frame editorial photograph with the left third kept as open, low-detail negative space`.

- Describe copy-overlay placement as **reserved empty space in photographic terms, never as text**: write `the left third kept as open, low-detail negative space` — NOT `hero with the headline overlaid on the left`. Naming a headline or menu in the pageContext is the trigger for the model painting ghost text into that exact region — and so is design-comp vocabulary like `hero cover background`: prefer photographic slot language (`editorial photograph`, `full-frame backdrop`) over web-layout language (`hero`, `banner`, `cover background`).
- The structured `aspectRatio` field is authoritative for canvas shape; pageContext must not contradict it.

### style

One of: `photorealistic` (default), `digital-art`, `illustration`, `minimalist`, `flat-design`, `3d-render`, `abstract`, `watercolor`. Keep one style per site unless the design deliberately mixes.

### aspectRatio — match the slot

- `landscape` (16:9) — the default for hero and banner images and wide feature/gallery rows
- `ultrawide` (21:9) — ONLY for full-bleed backgrounds spanning the viewport edge to edge; never for contained images, cards, or columns
- `portrait` (9:16) — dramatic tall images: full-height editorial shots, tall side-by-side panels
- `card-landscape` (4:3) — contained landscape slots: product cards, blog thumbnails, feature images in columns
- `card-portrait` (3:4) — the natural portrait-card shape: team headshots, tall product cards, framed insets; prefer over `portrait` for anything in a card or column
- `square` (1:1) — only when the layout slot is genuinely 1:1

A full-bleed cover BACKGROUND must be `landscape` or `ultrawide` — never square, portrait, or a card ratio. **Grid/row consistency:** all images displayed together in one row or grid MUST share the same aspect ratio — never mix.

### siteContext and imageGrade (shared per call)

- `siteContext`: one sentence of subject matter ("A neighborhood bakery selling sourdough and pastries."). **NEVER include the site or business name** — a name in the prompt is what painted-in fake wordmarks stand in for.
- `imageGrade`: ONE site-wide photographic treatment (e.g. "warm natural window light, soft muted color, gentle film grain"), derived from the visual direction. Use the identical grade in every call for the site so all imagery reads as one photographic series.

## Images for design options

The look is picked on one image and the layout on a set, both from the `site-spec` skill's design steps:

- **The look image**: before the look options, one `generate_images` call with a single image, the site's first-screen scene in `landscape`, at `<site>/wp-content/uploads/<scene>.png`, with the call-wide `imageGrade` left out and a neutral, versatile grade in `pageContext` ("natural light, true color, moderate contrast"). Pass the path it reports as each look's `image`. Every look's board shows this same photo under that look's `imagery` treatment from its `DESIGN.md` draft, so the user compares looks rather than photo content. A direction that rejects photography (its Imagery line says none, or type-only) passes no image: its board shows a pattern.
- **The site's set**: once `DESIGN.md` is written, one `generate_images` call with 3–4 images in the picked look, with its Imagery section as the call-wide `imageGrade` and its `style` if it is not photographic: the first-screen scene again plus distinct supporting subjects (a detail, a place or a person, a product), each in the aspect ratio of the slot it is most likely to fill, at `<site>/wp-content/uploads/<name>.png`. The set is content imagery: the layout sneak peeks use the paths it reports, and the build starts from its attachment IDs and URLs. When a template or template part needs one of its images, copy that file into the theme's `assets/images` and reference the copy. Generate more only for slots the set cannot fill, with the same `imageGrade`. The look image is in the media library too, for a look its treatment reproduced.
- **A failed or unavailable image** is not a blocker: the board shows a pattern, and a sneak-peek slot a solid color shape.

## No decorative or transparent images

Generated imagery is for CONTENT — covers, feature/gallery/card images, photographic bands. Never generate decorative assets: no ornaments, flourishes, crests, stamps, icons, or logo marks. They come out off-palette and geometrically wobbly, and small raster icons turn to mush. Decoration comes from theme primitives (separators, borders, spacing, type); feature icons: use none — let type and layout carry the hierarchy.

## Cover blocks

For `wp:cover` backgrounds, set the same image URL on BOTH the block's `url` attribute and the inner `<img>` src. Wide cover images (`landscape`/`ultrawide`) are generated at 2K automatically.

## Failure handling

- **Safety-filtered image**: rewrite that image's subject to avoid the flagged element and call `generate_images` again for just that image. One retry; if it fails again, treat as a permanent failure.
- **Permanent failure**: adapt the layout to work without that image (a color/gradient background, a text-led card). NEVER substitute an unrelated image, source an image from a web URL, or leave a reference to a file that does not exist.
- Failures arrive after the call returns, with a later tool result; `take_screenshot`, `inspect_design`, and `present_design_options` wait for the images.
