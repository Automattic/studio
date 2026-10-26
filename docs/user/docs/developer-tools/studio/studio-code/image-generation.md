# Image generation

Studio Code can generate original images as it builds and edits your site. When a design calls for imagery — a cover background, feature or gallery images, team photos, product shots — the agent can create and use those images, so pages arrive with real pictures instead of grey placeholder boxes or broken image references.

Image generation is available in Studio 1.20.0 and later.

## [Requirements](#0-requirements)

-   **Studio 1.20.0 or later**, whether using the desktop or terminal version.
-   **A connected WordPress.com account.** Image generation runs through your WordPress.com connection.
-   **AI credits.** Generating images is AI work and draws on the same credit balance as the rest of Studio Code. See [How AI Credits Work](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/ai-credits-guidelines/).

If a session has no WordPress.com login — for example, a session using only your own Anthropic API key — image generation is disabled.

When you use Studio through another agent over [MCP](https://developer.wordpress.com/docs/developer-tools/studio/mcp-on-studio/), that agent makes site images with its own image tool, such as Codex’s `image_gen`, on your plan with that agent.

## [Using it](#1-using-it)

There is no separate image generation mode or button. Ask for what you want in natural language and the agent generates imagery when the design needs it:

```
Build a homepage for a neighborhood bakery, with a full-width cover photo and a three-column section for the signature loaves.
```

```
The gallery images on the About page look generic. Regenerate them so they show the workshop itself, not stock-style close-ups.
```

You can also steer the agent directly:

```
Use warm natural window light and soft, muted color for all the imagery.
```

The agent plans every image a page needs **before** it writes the markup, then generates them together and points the markup at the finished files. That ordering is deliberate: your pages never reference an image that doesn’t exist yet.

Generation takes a few seconds per image, and it generates a page’s worth of images in parallel. A single request can cover up to 20 images, so a whole page — or a small site — is usually one batch.

## [What gets produced](#2-what-gets-produced)

All generated images are **JPEGs**. Full-width formats are rendered at a higher resolution than contained ones, so cover images stay sharp edge to edge without making every thumbnail expensive.

The agent picks a canvas shape to match the layout slot:

| Shape | Ratio | Typical use |
| --- | --- | --- |
| landscape | 16:9 | Cover and banner images, wide feature rows — the default |
| ultrawide | 21:9 | Full-bleed backgrounds spanning the viewport edge to edge |
| portrait | 9:16 | Tall editorial shots, full-height panels |
| card-landscape | 4:3 | Product cards, blog thumbnails, feature images in columns |
| card-portrait | 3:4 | Team headshots, tall product cards, framed insets |
| square | 1:1 | Slots that are genuinely square |

Images shown together in one row or grid always share a shape, so grids stay even.

Eight rendering styles are available — `photorealistic` (the default), `digital-art`, `illustration`, `minimalist`, `flat-design`, `3d-render`, `abstract`, and `watercolor`. The agent normally holds one style across a site unless you ask it to mix.

## [Where the files go](#3-where-the-files-go)

Generated images are written inside your site directory, and where they land depends on what the image is for:

-   **Theme imagery** — cover backgrounds in templates and template parts, section background bands, anything that belongs to the theme’s design — is written to `wp-content/themes/<theme-slug>/assets/images/` and referenced from the markup by path. It travels with the theme when you export or sync it.
-   **Content imagery** — product shots, team photos, gallery items, feature images that live inside a page or post — is imported into the **media library** as a real attachment. Blocks reference it by attachment ID and URL, exactly as they would an image you uploaded yourself, so you can swap, crop, or reuse it from the editor afterward.

Every content image is given descriptive alt text in the markup. Cover backgrounds are treated as decorative and left with empty alt, which is the correct accessible behavior for a background image sitting behind its own heading.

Files are only ever written inside your Studio sites directory.

## [Getting better results](#4-getting-better-results)

-   **Describe subject matter and mood, not file specs.** “A quiet workshop with morning light coming through high windows” gives the agent far more to work with than “a hero image.”
-   **Set a visual direction once.** Naming the light, color, and finish you want early keeps every image on the site consistent.
-   **Ask for text as content, not as a picture.** “Put the tagline over the cover image” produces real typography over the photo, which is what you want. “Generate an image with our tagline written on it” is the one request the feature will decline.
-   **Iterate per image.** You can ask the agent to regenerate a single image without touching the rest of the page.
-   **Check the result.** Ask the agent to screenshot the page — it can confirm the images render, fill their slots, and keep overlaid text legible.

## [Related](#5-related)

-   [Agent Skills in Studio](https://developer.wordpress.com/docs/developer-tools/studio/agent-skills-wordpress-studio/) — the imagery workflow ships as a built-in skill you can also invoke directly.
-   [MCP on Studio](https://developer.wordpress.com/docs/developer-tools/studio/mcp-on-studio/) — how other agents use Studio, including image generation.
-   [How AI Credits Work](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/ai-credits-guidelines/)