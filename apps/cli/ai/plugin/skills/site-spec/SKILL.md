---
name: site-spec
description: Gather user preferences before building a WordPress site. Asks about purpose, audience, brand personality, aesthetic direction, colors, and content structure. Run this before creating any new site.
user-invokable: true
---

# Site Spec Discovery

Before creating a new WordPress site, gather the user's preferences through a short interactive discovery phase. This produces a **Site Spec** that guides all subsequent design and development decisions.

## How to Run

Use AskUserQuestion to ask focused questions in 2-3 rounds, building on previous answers. Keep it concise — no more than 5-6 questions total.

**AskUserQuestion constraints**: Each call supports 1-4 questions, each with 2-4 options. An "Other" free-form option is automatically provided by the system — do NOT add one yourself. Keep option labels short (1-5 words). Only use AskUserQuestion for questions that have meaningful predefined options. For open-ended questions (like asking for a name), just ask in your text output — the user will type their answer in the prompt.

### Round 1 — Name & Purpose

First, ask the user for their business/site name in your text output (not via AskUserQuestion — it's open-ended with no predefined options). Then use AskUserQuestion for:
- What is this site for? (e.g., business type, portfolio, blog, community, e-commerce, agency, restaurant, etc.)
- Who is the target audience? (e.g., professionals, consumers, creatives, developers, local community, etc.)

### Round 2 — Brand & Aesthetic Direction

Adapt based on Round 1 answers. Ask about:
- What tone or personality should the site convey? (e.g., professional, playful, minimalist, bold, luxurious, raw, editorial, retro, organic, etc.)
- Any reference sites or brands you admire? Or styles you want to avoid?

### Round 3 — Visual & Structural Preferences

Adapt based on previous answers. Ask about:
- Color preferences or existing brand colors? (or let the user say "surprise me")
- One-page site or multi-page site? (e.g., single scrollable page with sections vs. separate pages for each area)
- What pages/sections do you need? (e.g., homepage, about, services, blog, contact, shop, gallery, etc.) — adapt the phrasing based on the one-page vs. multi-page answer

## Synthesize the Site Spec

After gathering answers, produce a concise **Site Spec** document:

```
Site Spec: [Site Name]
- Purpose: [what the site is for]
- Audience: [who it's for]
- Tone: [personality/voice]
- Aesthetic direction: [visual style, references]
- Color palette: [colors or direction]
- Layout: [one-page or multi-page]
- Pages/Structure: [list of pages or sections and key features]
- Key differentiator: [the one thing that makes this site memorable]
```

Show the spec to the user, then use AskUserQuestion to ask for confirmation (e.g., "Ready to build this site?" with options like "Yes, let's go" / "I'd like to adjust something"). Do NOT just print a text question and wait — always use the AskUserQuestion tool for confirmation so the user gets interactive options.

## After Confirmation

1. Call `site_create` with an appropriate name derived from the spec.
2. Save the site spec to `{site_path}/.agents/site-spec.md` using the Write tool, so it persists for future sessions.
3. Use the spec to guide ALL subsequent design decisions — theme, typography, colors, layout, content tone, and page structure.

## When to Skip Discovery

Do NOT ask questions if:
- The user already provided an asnwer for that specific question in the initial prompt. (e.g., "build me a dark minimalist portfolio for a photographer with these 5 pages using navy and gold colors"). Instead, synthesize the spec directly from their request and confirm.
- The user says "just build something" or "surprise me". Pick a bold creative direction yourself and proceed.
- The user explicitly asks to skip the setup or says they don't want questions.

In all skip cases, still synthesize and show a Site Spec before creating the site.
