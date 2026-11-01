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

The agent plans every image a page needs **before** it writes the markup. It asks for them all at once and gets each image’s file path, and for media library images the attachment ID and URL, right away. The images are then generated in the background, five at a time, while the agent writes the markup that uses them. Screenshots and design previews wait for the images to finish, and if an image fails, the agent is told so it can generate it again or adapt the layout. Your pages never keep a reference to an image that doesn’t exist.

A single request can cover up to 20 images, so a whole page — or a small site — is usually one batch.

## [What gets produced](#2-what-gets-produced)

All generated images are **PNGs**. They come in three canvas sizes: 1024×1024 (square), 1536×1024 (landscape), and 1024×1536 (portrait).

The agent asks for a shape to match the layout slot, and Studio renders it on the nearest canvas. The page’s CSS then crops the image to its slot:

| Shape | Ratio | Typical use | Canvas |
| --- | --- | --- | --- |
| landscape | 16:9 | Cover and banner images, wide feature rows — the default | 1536×1024 |
| ultrawide | 21:9 | Full-bleed backgrounds spanning the viewport edge to edge | 1536×1024 |
| portrait | 9:16 | Tall editorial shots, full-height panels | 1024×1536 |
| card-landscape | 4:3 | Product cards, blog thumbnails, feature images in columns | 1536×1024 |
| card-portrait | 3:4 | Team headshots, tall product cards, framed insets | 1024×1536 |
| square | 1:1 | Slots that are genuinely square | 1024×1024 |

Images shown together in one row or grid always share a shape, so grids stay even.

Eight rendering styles are available — `photorealistic` (the default), `digital-art`, `illustration`, `minimalist`, `flat-design`, `3d-render`, `abstract`, and `watercolor`. The agent normally holds one style across a site unless you ask it to mix.

## [Where the files go](#3-where-the-files-go)

Generated images are written inside your site directory, and where they land depends on where the image is shown:

-   **Theme imagery** — images shown by the theme’s own files: templates, template parts such as the header or footer, and `style.css` — is written to `wp-content/themes/<theme-slug>/assets/images/` and referenced from the markup by path. It travels with the theme when you export or sync it.
-   **Content imagery** — every image shown inside a page or post, including a page’s cover image, product shots, team photos, and gallery items — is imported into the **media library** as a real attachment. Blocks reference it by attachment ID and URL, exactly as they would an image you uploaded yourself, so you can swap, crop, or reuse it from the editor afterward.

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