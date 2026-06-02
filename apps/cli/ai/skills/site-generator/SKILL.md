---
name: site-generator
description: Generate a complete WordPress site — a pure-presentation theme plus a companion plugin — from a description. Load FIRST when the user wants to build a whole new site or theme. Orchestrates spec, design selection, parallel theme generation, companion plugin, content seeding, AI imagery, and validation.
user-invokable: true
---

# Site Generator

This is the orchestrator for building a complete WordPress site end to end. It
uses dedicated generation tools that run many model calls in parallel and write
whole packages to disk in one call — far faster and more complete than writing
files one per turn. Your job is to drive the pipeline in order and verify the
result, not to hand-author theme files.

## Output model (read this first)

Every generated site is TWO packages:

- **Theme** — pure presentation: `theme.json`, `style.css`, `templates/`,
  `parts/`, `patterns/`, `assets/`. Minimal `functions.php`. No behaviour.
- **Companion plugin** — all behaviour: custom post types, taxonomies, post
  meta, REST routes, and build-less plain-JS blocks. Survives a theme switch.

Page content is seeded into the **live database**, never baked into the theme.
For background, the `theme-architecture`, `companion-plugin`, `layout-patterns`,
`data-persistence`, and `wp-best-practices` skills hold the doctrine the
generators apply; load them if you need to reason about a result or fix it.

## Pipeline

### 1. Resolve the site

- If the user is building a brand-new site, run the `site-spec` skill to gather
  the site name and any layout preference, then call **`site_create`**.
- If they want to use an existing/active site, use that one (`site_info`).

### 2. Build the site spec (JSON)

Synthesize a JSON spec string you will pass to every generation tool. Use the
`theme-architecture` skill's layout-mode and content-mode taxonomy to choose
sensible values, and the `visual-design` skill for aesthetic direction. Shape:

```json
{
  "name": "Ember & Oak",
  "type": "restaurant",
  "audience": "local diners looking for a special evening",
  "tone": "warm, refined, unfussy",
  "topic": "a wood-fired neighbourhood restaurant in Lisbon",
  "layoutPreference": "landing-page or vertical-stack",
  "pages": ["Home", "Menu", "About", "Reservations", "Contact"],
  "features": ["reservation form"]
}
```

Keep it concise but specific; the topic and tone drive design quality.

### 3. Generate and choose a design direction

Call **`generate_design_previews`** with `nameOrPath` and `spec`. It writes
several first-fold HTML previews to `<site>/design/` and opens them. Show the
user the directions and use **AskUserQuestion** to let them pick one (or ask for
a regenerate). Keep the chosen preview's HTML — you pass it next.

### 4. Generate the theme

Call **`generate_theme`** with `nameOrPath`, `spec`, and `design` (the chosen
preview's HTML or its brief). It generates the whole theme in parallel, writes
it, activates it, and returns a **MANIFEST** JSON block at the end of its output.
**Copy that manifest verbatim** — the next tools need it.

### 5. Generate the companion plugin (only if needed)

If the manifest's `companionPlugin.needed` is `true`, call
**`generate_companion_plugin`** with `nameOrPath`, `spec`, and the `manifest`.
It generates CPTs, REST routes, and build-less plain-JS blocks, then activates
the plugin. A brochure site with no forms/CPTs/interactive blocks skips this.

### 6. Seed content

Call **`seed_content`** with `nameOrPath`, `spec`, and the `manifest`. It
generates each page's block markup, fills AI_IMAGE placeholders with generated
imagery, publishes the pages into the database, and sets the home page as the
static front page.

### 7. Fill theme imagery

Call **`generate_image`** with `nameOrPath` and `themeSlug` (the manifest's
`themeSlug`) to fill any `AI_IMAGE:` placeholders left in theme templates/parts.

### 8. Verify and fix

- Run **`validate_and_fix_blocks`** (with `nameOrPath` and the relevant
  content/filePath) on generated block content; rewrite anything it flags.
- Run **`take_screenshot`** with `viewport: "all"` on the site URL. Check the
  navigation, hero, full-width sections (they must span the viewport — fix in
  markup with `align: "full"`, not CSS), color contrast, and spacing. Fix issues
  with `Edit`/`wp_cli` and re-verify.

## Rules

- The generation tools each run for a while (many parallel model calls). That is
  expected — let them complete; do not try to hand-write the files yourself.
- Always pass the SAME `spec` string and the SAME `manifest` through steps 4–7.
- Never put behaviour in the theme or content in theme files — the tools already
  enforce the split; don't undo it with manual `wp_cli`/`Write` edits.
- WordPress.com login is required (AI generation + imagery route through the
  WordPress.com AI proxy). If a tool reports a login error, tell the user to run
  `/login`.
- No emojis in any generated content.
