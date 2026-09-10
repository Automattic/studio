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

### The look

Load the `visual-design` skill and follow its "Concept and Direction" runbook. Then:

1. Call `pick_design` once with `options: 4`, up to two `chosen` pairs picked as the `visual-design` skill describes (each with its one-line reason), any `avoid` entries, and each side the brief named as `layoutNamedInBrief` or `directionNamedInBrief`; it adds random pairs to make four distinct options and returns their notes. Call it with `options: 1` and no `chosen` pairs — a single random draw — when a pick cannot happen: `AskUserQuestion` is unavailable, the user asked to be surprised or to skip the questions, or the brief names both the concept and the direction. Never call it again to get a different result.
2. Ask, once, "Which look should I build?" with one option per pair in the order drawn, labelled `<Concept> × <Direction>`. Do not describe the options in prose first — the question does that.
   - **In the Studio app** (`present_design_options` is available): when `generate_images` is available, load the `imagery` skill first and generate the option images in one call, following its "Images for design options" rules. Then write one sneak peek per option (see "Sneak peeks" in the `visual-design` skill) and pass each option's one-line description of the feel and its HTML to `present_design_options`.
   - **In the terminal** (`AskUserQuestion` only): pass each option with a one-line description of how its first screen would look. Nothing is rendered.
3. Build the picked pair. A typed answer ("2 but darker") is a preference to apply to the closest option. Keep the picked option's generated image — it becomes the site's hero, moved to its final home per the `imagery` skill — and delete the other options' files under `wp-content/uploads/studio-generated/`.

## After Gathering Answers

Use the layout preference to guide all subsequent design decisions.

State the plan as a short **Site Spec** summary before building, alongside the design direction. The summary MUST include a **Concept** line — the signature layout concept settled by `pick_design` or picked by the user, as `Concept: <catalog name> — <one-line adaptation>`, the entry's name verbatim so the user can find it, then the twist — followed by a **Layout map** (as the `visual-design` skill defines it: one line per section of the page saying what the concept does to it), a **Direction** line — the artistic direction settled by the same call or picked with the concept, as `Direction: <catalog name> — <one-line adaptation>` — and a **Functionality & plugins** line. A side designed from the brief rather than the catalog is stated as `Concept: <the brief's words> — <how it is built>` or `Direction: <the brief's words> — <how it is built>`. For the plugins line: review the requested features, load the `plugin-recommendations` skill, and list the specific plugins the site needs — e.g. WooCommerce for selling products, Jetpack Forms for a contact form, Jetpack Newsletter for email signups, Sensei LMS for courses, Crowdsignal for polls/surveys — or "None — core blocks only" when nothing beyond static content is required. Install the listed plugins while building (Workflow Step 3); do not silently hand-build static markup for a feature a plugin should provide.

## When to Skip the Questions

Skipping means skipping the interactive questions only — the design is then a single `pick_design` draw, and you still produce the Site Spec summary (including the Functionality & plugins line) before building. Do NOT ask questions if:
- The user already provided the layout preference in the initial prompt.
- The user says "just build something" or "surprise me". Pick a bold creative direction yourself and proceed.
- The user explicitly asks to skip the setup or says they don't want questions.
