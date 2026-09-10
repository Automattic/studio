---
name: site-spec
description: Gather the layout preference and plugin needs for the active site before building it. Run this after the site to work on has been picked and before any design work.
user-invokable: true
---

# Site Spec Discovery

Before building a WordPress site, gather the user's basic preferences through a short interactive discovery phase. This produces a **Site Spec** that guides all subsequent design and development decisions.

## Precondition: an active site

This skill works on the active site — the one announced at the top of the user's message, or the one selected by `site_create`, `site_info`, or `site_start`. It never creates a site. If there is no active site, stop and pick one first following the system prompt's site pick rules, then run this skill again.

## How to Run

**AskUserQuestion constraints**: Each call supports 1-4 questions, each with 2-4 options. An "Other" free-form option is automatically provided by the system — do NOT add one yourself. Keep option labels short (1-5 words). Only use AskUserQuestion for questions that have meaningful predefined options. For open-ended questions, just ask in your text output — the user will type their answer in the prompt.

Use AskUserQuestion for:
- One-page site or multi-page site? (e.g., single scrollable page with sections vs. separate pages for each area)

The business/brand name is the active site's name unless the prompt gives a different one. Do not ask for it. The one exception: when the site name is clearly a placeholder (e.g. "test", "Site 1") and the prompt gives no brand, ask for the brand name in your text output and **stop and wait for the reply** — do NOT call any tools in that turn.

## After Gathering Answers

Use the layout preference to guide all subsequent design decisions.

State the plan as a short **Site Spec** summary before building, alongside the design direction. The summary MUST include a **Concept** line — the signature layout concept drawn by `pick_design` from your shortlist (see the `visual-design` skill), as `Concept: <name> — <one-line adaptation>` — followed by a **Layout map** (one line per section of the page saying what the concept does to it, as described in the `visual-design` skill), a **Direction** line — the artistic direction drawn by the same call, as `Direction: <name> — <one-line adaptation>` — and a **Functionality & plugins** line: review the requested features, load the `plugin-recommendations` skill, and list the specific plugins the site needs — e.g. WooCommerce for selling products, Jetpack Forms for a contact form, Jetpack Newsletter for email signups, Sensei LMS for courses, Crowdsignal for polls/surveys — or "None — core blocks only" when nothing beyond static content is required. Install the listed plugins while building (Workflow Step 5); do not silently hand-build static markup for a feature a plugin should provide.

## When to Skip the Questions

Skipping means skipping the interactive questions only — still produce the Site Spec summary (including the Functionality & plugins line) before building. Do NOT ask questions if:
- The user already provided the layout preference in the initial prompt.
- The user says "just build something" or "surprise me". Pick a bold creative direction yourself and proceed.
- The user explicitly asks to skip the setup or says they don't want questions.
