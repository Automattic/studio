---
name: imagery
description: Generate AI images for a site with generate_images, or with an image tool of your own when it is not available — the images the design steps need, where files go, how to write image specs, and how to handle failures.
---

# Site Imagery

## Images for the design steps

- **The look image**: before the look options, one image of the site's first-screen scene in `landscape` at `<site>/wp-content/uploads/<scene>.png`, with a neutral grade in `pageContext` and no `imageGrade`. Pass its path as each look's `image`. A direction that rejects photography passes no image.
- **The site's set**: once `DESIGN.md` is written, one call with 3–4 images in the picked look (its Imagery section as `imageGrade`): the first-screen scene plus distinct supporting subjects, each in the aspect ratio of its likely slot. The sneak peeks and the build use this set first; generate more only for slots it cannot fill, with the same `imageGrade`.

## Placing images

- **Content imagery** (anything shown by page or post content, heroes included): `<site>/wp-content/uploads/<name>.png`. The tool adds it to the media library; use the reported URL as `src` and the attachment ID in the block attributes.
- **Theme imagery** (shown by a template, part, or `style.css`): `<site>/wp-content/themes/<theme>/assets/images/<name>.png`, referenced by that path.
- Batch every image a page needs into one call, before writing the markup that uses them. Give content images real alt text.

## Writing specs

- `subject`: 1–3 sentences on what the image shows and its composition. Never ask for text, signage, or the business name; image models garble lettering.
- `pageContext`: the slot in photographic terms, in English (`full-frame photograph with the left third kept as open, low-detail space`), never layout words like "hero" or "headline".
- `aspectRatio`: the slot's shape; images in one row or grid share a ratio, and full-bleed backgrounds are `landscape` or `ultrawide`.
- `imageGrade`: one site-wide treatment, identical in every call.
- Generate content imagery only — no icons, ornaments, or logos.

## Without generate_images

With an image tool of your own, make the same images with the same intent, then `wp_cli media import` content images from the site's `tmp/` (it prints attachment IDs) and copy theme images into the theme.

## Failures

Rewrite a safety-filtered subject and retry once. If an image still fails, adapt the layout (color or text-led) — never use a web URL or reference a missing file.
