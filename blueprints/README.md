# Blueprints catalog (proof of concept)

The Blueprints that WordPress Studio offers when you add a site, as files in this repository: one folder per Blueprint, reviewed in pull requests like the code that runs them.

Today the catalog lives on a WordPress.com site (`blueprintlibrary.wordpress.com`) and reaches the app through `public-api.wordpress.com/wpcom/v2/studio-app/blueprints`. This folder is the proposed source of truth instead. [`Automattic/studio-website`](https://github.com/Automattic/studio-website) reads it at build time, the same way it reads `docs/user/docs`, and publishes:

- `wordpress.studio/blueprints/`: a gallery, and a page per Blueprint with a preview and the ways to open it in WordPress Studio;
- `wordpress.studio/blueprints/index.json`: the catalog, in the shape `fetchStudioBlueprints()` already parses.

Nothing reads this folder in the app yet. The snapshot here was taken from the live catalog on 2026-11-10.

## Layout

```
blueprints/
  index.json            the Blueprints to publish, in display order (folder names)
  <slug>/
    blueprint.json      the Blueprint
    meta.json           what the catalog shows about it (below)
    screenshot.<ext>    jpg, png or webp, ideally 16:10
    …                   any other file is a bundled resource the Blueprint refers to
```

The folder name is the slug: `studio blueprint use <slug>`, and `wordpress.studio/blueprints/<slug>/`.

### meta.json

| Key | |
|---|---|
| `title` | Name shown in the gallery and the Add site dialog. |
| `description` | One or two sentences. |
| `useCases` | Any of `business`, `blog`, `portfolio`, `store`, `events`, `development` (the filters of the Add site dialog; today these are hard-coded in `packages/common/lib/blueprint-catalog.ts`). |
| `demoUrl` | Optional. A hosted demo of the site. |
| `bundleUrl` | Optional. A bundle hosted elsewhere; see below. |

### Bundles

A Blueprint that uses `"resource": "bundled"` needs the files it refers to next to its `blueprint.json`. When a folder holds files other than `blueprint.json`, `meta.json` and the screenshot, the website build zips them with the Blueprint and serves the archive as the Blueprint's bundle. `wedding-rsvp` is the example.

Seven Blueprints still point at a bundle on `blueprintlibrary.wordpress.com` through `bundleUrl`. Their bundles carry a theme zip and demo content, 1 to 14 MB each and about 36 MB together, which is too much to commit here as it is. Before this replaces the current catalog they need a decision: install the theme from a URL instead of bundling it, keep large media out of the repository (releases, or the website's own storage), or accept the weight.

## Trying it

With a checkout of `Automattic/studio-website` on its `add/blueprints-demo` branch, running as a site in WordPress Studio:

```bash
STUDIO_BLUEPRINTS_SOURCE=/path/to/this/checkout node scripts/build-blueprints-catalog.mjs
```

Then point WordPress Studio at that site's catalog:

```bash
STUDIO_BLUEPRINTS_CATALOG_URL=http://localhost:<port>/blueprints/index.json studio blueprint list
```
