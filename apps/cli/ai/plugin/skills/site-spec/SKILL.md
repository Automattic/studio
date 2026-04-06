---
name: site-spec
description: Gather the project name, goals, structure, stack, and tone before building. Run this before creating any new project.
user-invokable: true
---

# Project Spec Discovery

Gather what you need to design the project. This is a **conversation**, not a form — be smart about what you already know.

## First: Read What the User Already Told You

Before asking anything, analyze the user's initial message. They often front-load a lot of information. Extract everything you can:
- Project name or working title
- What it's for and who it's for
- Visual direction, tone, or references
- Structure hints (single page, multiple pages, specific features)
- Technical preferences

**Only ask about what's genuinely missing.** If the user said "a portfolio site for my photography with a minimal, clean feel" — you already have the name direction, purpose, audience, and tone. Don't ask about any of those. Jump straight to what you don't know (structure? stack?).

If the user gave you everything, skip straight to design. If they gave you almost everything, ask one or two clarifying questions and move on. Never robotically walk through all five rounds when the user already answered most of them.

## What You Need (ask only for what's missing)

**Name** — What's the project called? If the user described it but didn't name it, suggest a name and ask if it works. Don't force them to name it if they haven't — you can propose one.

**Goals & Context** — What's the project for? Who's the audience? Any reference URLs or images? Ask conversationally, not as a checklist. If the user already explained this, acknowledge it and move on.

**Structure** — One-page or multi-page? Use AskUserQuestion with options only if you genuinely don't know. If the user described features that clearly imply multi-page (e.g. "user profiles, a feed, collections"), just confirm your assumption: "Sounds like this needs multiple pages — a feed, profile pages, collections. Sound right?"

**Stack** — Use AskUserQuestion:
- **Whatever works best** — We'll pick the best approach for your project
- **WordPress theme** — Full WordPress with blocks and the editor
- **React + WordPress** — React frontend, WordPress backend
- **Vue + WordPress** — Vue frontend, WordPress backend

Skip this entirely if the user specified a stack, or if the project clearly calls for a standard WordPress theme.

**Tone & Style** — Visual direction, colors, fonts, inspirations. If the user already shared images or described the vibe, build on that: "Love the 90s direction — I'm thinking neon colors, chunky fonts, geometric patterns. Any specific colors or sites that inspire you?" Don't ask from scratch if they already set the direction.

## AskUserQuestion Constraints

Each call supports 1-4 questions, each with 2-4 options. An "Other" free-form option is automatically provided — do NOT add one yourself. Keep labels short (1-5 words). Only use AskUserQuestion for genuine multiple-choice moments. For open-ended questions, just ask in your text output.

## Content Strategy

Generate contextually appropriate content based on the spec — real-ish copy that matches the project's purpose and tone, not lorem ipsum. Use relevant stock photos for imagery.

## After Gathering Answers

**CRITICAL: You MUST generate design previews before building anything.** Do NOT skip to `site_create` or theme building.

### Design Preview Phase

1. **Generate 2-3 design directions** as polished standalone HTML/CSS/JS files. Each should be a complete, impressive mockup — not a wireframe. Use real-ish content based on the spec.

2. **Write each option** as a standalone `.html` file. Store them in `~/Studio/previews/`. Each file should be self-contained with inline CSS and any JS needed. Also create an `index.html` with iframes showing all options side-by-side for easy comparison.

3. **Show the previews in the browser panel** by calling `browser_navigate` with the **full absolute file path** to the index.html (e.g. `browser_navigate("/Users/shaun/Studio/previews/index.html")`). The file will be served via a local HTTP server automatically. **You MUST call browser_navigate** — the user cannot see the files otherwise.

4. **Tell the user** you've created the design options and describe each direction briefly. Ask them to pick one, iterate, or mix elements.

5. **Wait for the user to commit** before building. They should explicitly say "build it" or pick an option. Until then, iterate on the designs based on feedback.

6. **Only after the user commits** to a design direction should you proceed to `site_create` and theme building.
