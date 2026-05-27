---
name: site-spec
description: Gather the site name, then auto-expand into a creative direction (pages, layout, hero, typography) before building a WordPress site. Run this before creating any new site.
user-invokable: true
---

# Site Spec Discovery

Before creating a new WordPress site, gather the user's name and expand it into a full creative direction. This produces a **Site Spec** that guides all subsequent design and development decisions.

**AskUserQuestion constraints**: Each call supports 1-4 questions, each with 2-4 options. An "Other" free-form option is automatically provided by the system — do NOT add one yourself. Keep option labels short (1-5 words). Only use AskUserQuestion for questions that have meaningful predefined options. For open-ended questions (like asking for a name), just ask in your text output — the user will type their answer in the prompt.

## Round 1 — Name

Ask the user for their business/site name in your text output — unless it was already stated clearly in their message (e.g. *"create a site called Pan de Casa"*), in which case use it directly and skip to Round 2.

**Critical**: if you ask the name question, your response must end immediately after that question. No tool calls. No Round 2. No extra text. The user will type their answer and send it — only after receiving their reply do you move to Round 2.

## Round 2 — Expand into a Creative Direction

Once you have the name, **do not ask questions about layout or pages**. Instead, infer everything from the name and context, commit to a concrete creative direction, and brief the user before building.

### Step A — Read the brief

| Signal | Action |
|--------|--------|
| Site type is clear ("Bar Boogie", "Morning Light Bakery") | Auto-expand — go to Step B |
| Site type is ambiguous ("a site for my business") | Ask **one** specific question to resolve it, then go to Step B |
| User said "minimal", "one page", or "just a placeholder" | Skip expansion — use a simple one-page layout, go to Step C |

### Step B — Decide the four pillars

Commit to all of these without asking:

**Layout** — Pick the shape that fits the site type:
- `vertical-stack` — standard header/content/footer (default)
- `landing-page` — single scrollable page, anchor-linked sections (portfolios, product launches, one-pager requests)
- `magazine-grid` — homepage is a post archive (blogs, publications)
- `canvas` — full-bleed imagery, floating chrome (photography, art portfolios)

**Pages & sections** — Decide which pages to create and what sections go on each. A bar needs Home + Menu + Events + Contact; a SaaS needs Home (features/pricing/CTA) + About + Contact. Match the type — don't default to a minimal skeleton.

**Hero composition** — One short paragraph of cinematic prose: composition strategy (full-bleed / asymmetric / centered / split), image placement, typographic weight, overall mood. This is the spatial anchor that guides downstream block choices. Example: *"A full-bleed photo of latte art fills the right two-thirds of the screen. Display-serif type sits left, large and slightly oversized. A single rust-colored CTA rests low with generous breathing room. The composition feels still, like a held breath."*

**Typography** — A font pairing that fits the name and type. Examples: coffee shop → Fraunces + Spectral; law firm → Cormorant Garamond + Source Sans; esports → Rajdhani + JetBrains Mono. When the signal is weak, default to a clean humanist pair.

### Step C — Brief the user in ≤4 lines

Tell the user what you decided before building. Example:

> *"Building a 5-page site for Boogie Bar: Home, Menu, Events, Gallery, and Contact. Dark & moody aesthetic, jazz-inspired typography, amber/black palette. Includes a reservations form and newsletter signup."*

**Do not ask for approval.** Proceed immediately to `site_create`.

## After site_create returns

The turn immediately after `site_create` is the biggest source of perceived hangs. Acknowledge the site in ≤2 lines of prose, then make your next tool call a small one — `site_info`, or a single ≤50-line first `Write`. Do NOT scaffold the theme, chain multiple Writes, or write a long design-plan essay in this turn. Grow the build across many small turns.

## When to Skip Discovery

Do NOT run this skill if:
- The user already provided the name AND a detailed layout/content spec. Proceed directly with site creation.
- The user says "just build something" or "surprise me". Pick a bold creative direction yourself and proceed.
- The user explicitly asks to skip setup.
