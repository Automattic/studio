---
name: site-spec
description: Gather the site name, layout preference, and aesthetic direction before building a WordPress site. Run this before creating any new site.
user-invokable: true
---

# Site Spec Discovery

Before creating a new WordPress site, gather the user's basic preferences through a short interactive discovery phase. This produces a **Site Spec** that guides all subsequent design and development decisions.

## How to Run

Gather preferences through 3 rounds. Keep it concise.

**AskUserQuestion constraints**: Each call supports 1-4 questions, each with **exactly 2-4 options per question** (hard cap — cannot exceed 4). An "Other" free-form option is automatically provided by the system — do NOT add one yourself and do NOT count it toward your 4. Keep option labels short (1-5 words). Only use AskUserQuestion for questions that have meaningful predefined options. For open-ended questions (like asking for a name), just ask in your text output — the user will type their answer in the prompt.

### Round 1 — Name

Ask the user for their business/site name in your text output. **Stop here and wait for their reply** — do NOT call any tools or continue to the next round. The user needs a chance to type their answer in the prompt.

### Round 2 — Layout

After the user provides the name, use AskUserQuestion for Layout **only**:

- **Question**: One-page site or multi-page site? (single scrollable page with sections vs. separate pages for each area)
- **Options**: `One-page`, `Multi-page`

Keep this as its own round — do not combine with other questions. Combining tends to cause option trimming.

### Round 3 — Aesthetic Direction

Before the AskUserQuestion call, **print the full menu of five directions in your text output** so the user sees all options, not just the clickable four. Example:

> "What aesthetic direction should the site take? Five presets:
> - **Minimalist** — restrained, calm, generous whitespace, precise type.
> - **Soft** — warm, airy, expensive-feeling, spring-like motion, muted palette.
> - **Editorial** — magazine-like, refined typography, measured asymmetry, serif display.
> - **Brutalist** — raw, mechanical, sharp contrast, Swiss/monospace typography.
> - **Maximalist** — bold, dense, kinetic motion, layered effects, playful chaos.
>
> Pick one below, or use 'Other' to describe a custom direction (retro-futurist, playful-toy, luxury-refined, etc.)."

Then call AskUserQuestion with **all four clickable options, no fewer**:

- **Question**: Which aesthetic direction?
- **Options** (MUST include all four):
  1. `Minimalist`
  2. `Soft`
  3. `Editorial`
  4. `Maximalist`
- **Header**: "Aesthetic"
- The auto-provided "Other" catches Brutalist + anything freeform.

**Do not drop options.** If you find yourself tempted to shrink the list to 3, you're wrong — the AskUserQuestion tool supports exactly 4 and the skill requires all 4.

### Aesthetic → Taste Dial Mapping

Use this when you load the `taste` skill later. The mapping is the skill's authoritative source — keep it in sync.

- **Minimalist** → VARIANCE 3, MOTION 4, DENSITY 3
- **Soft** → VARIANCE 4, MOTION 6, DENSITY 3
- **Editorial** → VARIANCE 6, MOTION 6, DENSITY 5
- **Brutalist** → VARIANCE 9, MOTION 7, DENSITY 6
- **Maximalist** → VARIANCE 9, MOTION 9, DENSITY 7
- **Other / freeform** — interpret the user's words literally: pick dials that match the mood they described. Don't silently fall back to a baseline.

## After Gathering Answers

Produce the **Site Spec** internally before calling `site_create`. The spec must include:
- Site name
- Layout (one-page / multi-page)
- Aesthetic direction (name + the three dial values)
- A one-sentence aesthetic brief you'll hand to the taste skill (e.g. "Editorial luxury for an architecture studio — measured asymmetry, serif display, muted stone palette")

Then call `site_create`. When you subsequently load the `taste` skill during the design-planning step, apply the dial preset from the aesthetic direction rather than the default baseline, and honor the brief throughout.

## When to Skip Discovery

Do NOT ask questions if:
- The user already provided the name, layout preference, and aesthetic direction in the initial prompt. Proceed directly with site creation.
- The user says "just build something" or "surprise me". Pick a bold creative direction yourself (vary across generations — don't default to the same direction twice) and proceed.
- The user explicitly asks to skip the setup or says they don't want questions.

If the user provided *some* of the three inputs but not all, only ask about the missing ones.
