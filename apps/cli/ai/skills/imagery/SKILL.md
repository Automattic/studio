---
name: imagery
description: Generate AI images for a site with generate_images, or with an image tool of your own when it is not available — the images the design steps need, where files go, and how to write image specs.
tools: generate_images
---

# Site Imagery

## Images for the design steps

- **The look image**: one image of the site's first-screen scene, in `landscape` at `<site>/wp-content/uploads/<scene>.png`, with a neutral grade in `pageContext` and no `imageGrade`, passed as each look option's `image`. A direction that rejects photography passes none.
- **The site's set**: once the look is picked, 3–4 images in one call, with the direction's Imagery line as `imageGrade`: the first-screen scene plus distinct supporting subjects, each in the aspect ratio of its likely slot. The sneak peeks and the build use this set first.

## Where images go

- **Content imagery** (shown by page or post content, heroes included): `<site>/wp-content/uploads/<name>.png`, added to the media library; its URL is the `src` and its attachment ID goes in the block attributes. Give it real alt text.
- **Theme imagery** (shown by a template, part, or `style.css`): `<site>/wp-content/themes/<theme>/assets/images/<name>.png`, referenced by that path.
- Content imagery only — icons, ornaments, and logos are not generated.

## Without generate_images

With an image tool of your own, make the same images with the same intent, then `wp media import` content images from the site's `tmp/` (it prints attachment IDs) and copy theme images into the theme.
