---
name: build-site
description: Create, build, design, redesign, or rebuild a whole site — pick or create the site, settle the design and plugins as a Site Spec, then scaffold the theme, provision the site, validate and publish the content, and polish the result. Load it before picking or creating the site.
user-invokable: true
---

# Build a Site

Follow these steps in order. Run every step even when the prompt already answers the discovery questions: skip the questions, but still produce the Site Spec.

## 1. Pick or create the site

The build works on exactly one site, settled before anything else: do not plan a design or write files until it is. The active site is the one announced at the top of the user's message.

- **Active site, and the prompt gives no site or business name, or gives the active site's name** (including "redesign" / "update" / "change this site"): Build on the active site. Do not ask whether to create a new one.
- **Active site, and the prompt gives a site or business name that differs from the active site's name** (e.g. active site "Test" and "build a site for Joe's Bakery" or "a site named Joe's Bakery"): STOP and ask before doing anything else. The name may be the brand for the active site or a request for a second site, and only the user can tell you which. Never resolve this yourself, and never call site_create or start building before the answer. Use AskUserQuestion when available with options like "Use current site" and "Create new site"; otherwise ask in your text output and end your turn.
- **Explicit "new" / "separate" / "another" site, or no active site**: Call site_create. If the prompt gives no name, ask for one in your text output and wait for the reply.

## 2. Site Spec

Before building, gather the user's basic preferences through a short interactive discovery phase. This produces a **Site Spec** that guides all subsequent design and development decisions.

**AskUserQuestion constraints**: Each call supports 1-4 questions, each with 2-4 options. An "Other" free-form option is automatically provided by the system — do NOT add one yourself. Keep option labels short (1-5 words). Only use AskUserQuestion for questions that have meaningful predefined options. For open-ended questions, just ask in your text output — the user will type their answer in the prompt.

Use AskUserQuestion for:
- One-page site or multi-page site? (e.g., single scrollable page with sections vs. separate pages for each area)

The business/brand name is the active site's name unless the prompt gives a different one. Do not ask for it. The one exception: when the site name is clearly a placeholder (e.g. "test", "Site 1") and the prompt gives no brand, ask for the brand name in your text output and **stop and wait for the reply** — do NOT call any tools in that turn.

A new site's spec needs nothing from the site itself: do not search its files or list its plugins and themes before the design is settled.

### The design

Load the `visual-design` skill first — the catalogs, the DESIGN.md format, and the sneak-peek rules live there — and follow its "Concept and Direction" runbook. The design is settled in two steps, the look and then the layout, each with one `pick_design` call, repeated only when the user asks for other options:

- Pass `options: 4` so the user picks, or `options: 1` when there is nothing to pick — the user asked to be surprised or to skip the questions, or the brief names that step's catalog entry. Neither a page count ("one page") nor adjectives ("elegant", "warm") pick an entry: ask, and apply them to the options you choose. For a reference site, look at it once with `take_screenshot` (`display: false`) and choose its closest entries, with `options` set to their number: two when `present_design_options` is available, otherwise one.
- With one entry, use it without asking. With more, ask once, one option per entry in the order returned, labelled with the entry's name, without describing the options in prose first. A typed answer ("2 but darker") is a preference to apply to the closest option; asking for other options, as a choice or in their own words, means drawing that step again and asking the same way.

1. **The look**: `catalog: "directions"`, asking "Which look should I build?". Skip this step when the active-site line names a design system and the user did not ask for a new look.
   - If `present_design_options` is available: when you can make images (`generate_images`, or an image tool of your own), load the `imagery` skill and make the look image first. Pass each option's `DESIGN.md` draft (see the `visual-design` skill) as its `preview`, with that image and a one-line description of the feel.
   - Otherwise use `AskUserQuestion`, each option with a one-line description of the look.
   - Write the picked look to `DESIGN.md` at the site root: the draft's front matter exactly as the user saw it, then every section. Then, when you can make images (`generate_images`, or an image tool of your own), load the `imagery` skill and make the site's image set in that look so the layout previews and the build have it.
2. **The layout**: `catalog: "layouts"`, asking "Which layout should I build?".
   - If `present_design_options` is available: pass one sneak peek per option, in the picked look and with the site's image set (see the `visual-design` skill), as its `preview`, with a one-line description of the layout.
   - Otherwise use `AskUserQuestion`, each option with a one-line description of how its first screen would look.
   - Add the picked layout to the Layout section of `DESIGN.md`, then build it.

### The Site Spec

Before step 3, state the plan in your text output as a short **Site Spec** summary. The summary MUST include a **Concept** line — the signature layout concept settled by `pick_design` or picked by the user, as `Concept: <catalog name> — <one-line adaptation>`, the entry's name verbatim so the user can find it, then the twist — followed by a **Layout map** (as the `visual-design` skill defines it: one line per section of the page saying what the concept does to it), a **Direction** line — the artistic direction behind `DESIGN.md`, as `Direction: <catalog name> — <one-line adaptation>` — and a **Functionality & plugins** line. A side designed from the brief rather than the catalog is stated as `Concept: <the brief's words> — <how it is built>` or `Direction: <the brief's words> — <how it is built>`. For the plugins line: review the requested features, load the `plugin-recommendations` skill, and list the specific plugins the site needs — e.g. WooCommerce for selling products, Jetpack Forms for a contact form, Jetpack Newsletter for email signups, Sensei LMS for courses, Crowdsignal for polls/surveys — or "None — core blocks only" when nothing beyond static content is required. Install the listed plugins in step 4; do not silently hand-build static markup for a feature a plugin should provide.

### When to Skip the Questions

Skipping means skipping the interactive questions only — each design step then returns a single entry, `DESIGN.md` is still written, and you still produce the Site Spec summary (including the Functionality & plugins line) before building. Do NOT ask questions if:
- The user says "just build something" or "surprise me". Pick a bold creative direction yourself and proceed.
- The user explicitly asks to skip the setup or says they don't want questions.

## 3. Theme files

With the Site Spec stated, start small: call `scaffold_theme` on its own, and never fill a whole theme at once. For a new custom theme, call it without `parentTheme`. When the site has a DESIGN.md, the scaffold fills theme.json from it and self-hosts its Google Fonts, so edit theme.json only for what DESIGN.md does not cover. Then fill the scaffold one file at a time with Write and Edit: templates, parts, style.css, and patterns.

## 4. Provision the site

Use wp_cli to activate the theme, install and activate the plugins the Site Spec lists, and set options. Do this before validating — the live editor only recognizes the active theme and registered plugin blocks. The site must be running.

## 5. Validate and publish the content

Validate each template and part with validate_blocks right after writing it, and validate page and post content before it reaches the site. Then create or update the pages and posts with the validated content. A build that skips validate_blocks is incomplete.

## 6. Check and polish the result

You MUST load the `visual-polish` skill and follow its instructions. The design must match your original expectations. Do not inspect the design or take a screenshot before loading the skill.

## 7. Set the theme screenshot

When the active theme was scaffolded by Studio Code, pass its directory as `themeScreenshot` on every desktop take_screenshot of the home page: the last capture becomes the theme's thumbnail in Appearance → Themes.
