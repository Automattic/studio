---
name: site-spec
description: Gather the layout preference and plugin needs for the active site before building it. Run this after the site to work on has been picked and before any design work.
user-invokable: true
---

# Site Spec Discovery

Before building a WordPress site, gather the user's basic preferences through a short interactive discovery phase. This produces a **Site Spec** that guides all subsequent design and development decisions.

## Precondition: an active site

This skill works on the active site — the one announced at the top of the user's message. If there is no active site, stop and let the user know.

## How to Run

**AskUserQuestion constraints**: Each call supports 1-4 questions, each with 2-4 options. An "Other" free-form option is automatically provided by the system — do NOT add one yourself. Keep option labels short (1-5 words). Only use AskUserQuestion for questions that have meaningful predefined options. For open-ended questions, just ask in your text output — the user will type their answer in the prompt.

Use AskUserQuestion for:
- One-page site or multi-page site? (e.g., single scrollable page with sections vs. separate pages for each area)

The business/brand name is the active site's name unless the prompt gives a different one. Do not ask for it. The one exception: when the site name is clearly a placeholder (e.g. "test", "Site 1") and the prompt gives no brand, ask for the brand name in your text output and **stop and wait for the reply** — do NOT call any tools in that turn.

A new site's spec needs nothing from the site itself: do not search its files or list its plugins and themes before the design is settled.

### The design

Load the `visual-design` skill first — the catalogs, the DESIGN.md format, and the sneak-peek rules live there — with the `imagery` skill in the same turn when `generate_images` is available, and follow its "Concept and Direction" runbook. The design is settled in two steps, the look and then the layout, each with one `pick_design` call, repeated only when the user asks for other options:

- Pass `options: 4` so the user picks, or `options: 1` when there is nothing to pick — the user asked to be surprised or to skip the questions, or the brief names the entry. For a reference site, look at it once with `take_screenshot` (`display: false`) and choose its closest entries, with `options` set to their number: two when `present_design_options` is available, otherwise one.
- With one entry, use it without asking. With more, ask once, one option per entry in the order returned, labelled with the entry's name, without describing the options in prose first. A typed answer ("2 but darker") is a preference to apply to the closest option; asking for other options, as a choice or in their own words, means drawing that step again and asking the same way.

1. **The look**: `catalog: "directions"`, asking "Which look should I build?". Skip this step when the active-site line names a design system and the user did not ask for a new look.
   - If `present_design_options` is available: when `generate_images` is available too, start the look image in the background in the same turn as `pick_design` (see the `imagery` skill). Pass each option's `DESIGN.md` draft (see the `visual-design` skill) as its `preview`, with that image and a one-line description of the feel; `present_design_options` waits for the image.
   - Otherwise use `AskUserQuestion`, each option with a one-line description of the look.
   - Write the picked look to `DESIGN.md` at the site root: the draft's front matter exactly as the user saw it, then every section. When `generate_images` is available, also generate the site's image set in that look (see the `imagery` skill) so the layout previews and the build have it: with `present_design_options`, start it in the background right after the pick, in the same turn as the layout's `pick_design` and before the `DESIGN.md` write, so it generates while you write `DESIGN.md` and the sneak peeks.
2. **The layout**: `catalog: "layouts"`, asking "Which layout should I build?".
   - If `present_design_options` is available: pass one sneak peek per option, in the picked look and with the site's image set (see the `visual-design` skill), as its `preview`, with a one-line description of the layout. It waits for the set and reports each image; a failed one shows as a solid color shape, and needs a rewrite or a fallback before the build.
   - Otherwise use `AskUserQuestion`, each option with a one-line description of how its first screen would look.
   - Add the picked layout to the Layout section of `DESIGN.md`, then build it.

## After Gathering Answers

Use the layout preference to guide all subsequent design decisions.

State the plan as a short **Site Spec** summary before building. The summary MUST include a **Concept** line — the signature layout concept settled by `pick_design` or picked by the user, as `Concept: <catalog name> — <one-line adaptation>`, the entry's name verbatim so the user can find it, then the twist — followed by a **Layout map** (as the `visual-design` skill defines it: one line per section of the page saying what the concept does to it), a **Direction** line — the artistic direction behind `DESIGN.md`, as `Direction: <catalog name> — <one-line adaptation>` — and a **Functionality & plugins** line. A side designed from the brief rather than the catalog is stated as `Concept: <the brief's words> — <how it is built>` or `Direction: <the brief's words> — <how it is built>`. For the plugins line: review the requested features, load the `plugin-recommendations` skill, and list the specific plugins the site needs — e.g. WooCommerce for selling products, Jetpack Forms for a contact form, Jetpack Newsletter for email signups, Sensei LMS for courses, Crowdsignal for polls/surveys — or "None — core blocks only" when nothing beyond static content is required. Install the listed plugins while building (Workflow Step 3); do not silently hand-build static markup for a feature a plugin should provide.

## When to Skip the Questions

Skipping means skipping the interactive questions only — each design step then returns a single entry, `DESIGN.md` is still written, and you still produce the Site Spec summary (including the Functionality & plugins line) before building. Do NOT ask questions if:
- The user already provided the layout preference in the initial prompt.
- The user says "just build something" or "surprise me". Pick a bold creative direction yourself and proceed.
- The user explicitly asks to skip the setup or says they don't want questions.
