---
name: site-spec
description: Gather the site name and layout preference before building a WordPress site. Run this before creating any new site.
user-invokable: true
---

# Site Spec Discovery

Before creating a new WordPress site, gather the user's basic preferences through a short interactive discovery phase. This produces a **Site Spec** that guides all subsequent design and development decisions.

## How to Run

Gather preferences through 2 rounds. Keep it concise.

**AskUserQuestion constraints**: Each call supports 1-4 questions, each with 2-4 options. An "Other" free-form option is automatically provided by the system — do NOT add one yourself. Keep option labels short (1-5 words). Only use AskUserQuestion for questions that have meaningful predefined options. For open-ended questions (like asking for a name), just ask in your text output — the user will type their answer in the prompt.

### Round 1 — Name

Ask the user for their business/site name in your text output. **Stop here and wait for their reply** — do NOT call any tools or continue to the next round. The user needs a chance to type their answer in the prompt.

### Round 2 — Layout

After the user provides the name, use AskUserQuestion for:
- One-page site or multi-page site? (e.g., single scrollable page with sections vs. separate pages for each area)

## After Gathering Answers

Call `site_create` with the provided name and use the layout preference to guide all subsequent design decisions.

State the plan as a short **Site Spec** summary before building, alongside the design direction. The summary MUST include a **Concept** line — the signature concept picked from the `visual-design` skill's shortlist, as `Concept: <name> — <one-line adaptation>` — and a **Functionality & plugins** line: review the requested features, load the `plugin-recommendations` skill, and list the specific plugins the site needs — e.g. WooCommerce for selling products, Jetpack Forms for a contact form, Jetpack Newsletter for email signups, Sensei LMS for courses, Crowdsignal for polls/surveys — or "None — core blocks only" when nothing beyond static content is required. Install the listed plugins while building (Workflow Step 4); do not silently hand-build static markup for a feature a plugin should provide.

## After site_create returns

The turn immediately after `site_create` is the biggest source of perceived hangs. Acknowledge the site in ≤2 lines of prose, then make your next tool call a small one — `site_info`, or a single ≤50-line first `Write`. Do NOT scaffold the theme, chain multiple Writes, or write a long design-plan essay in this turn. Grow the build across many small turns (see the "Working cadence" section of the system prompt).

## When to Skip Discovery

Skipping means skipping the interactive questions only — still produce the Site Spec summary (including the Functionality & plugins line) before building. Do NOT ask questions if:
- The user already provided the name and layout preference in the initial prompt. Proceed directly with site creation.
- The user says "just build something" or "surprise me". Pick a bold creative direction yourself and proceed.
- The user explicitly asks to skip the setup or says they don't want questions.
