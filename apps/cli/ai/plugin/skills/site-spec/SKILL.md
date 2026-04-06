---
name: site-spec
description: Gather the project name, goals, structure, stack, and tone before building. Run this before creating any new project.
user-invokable: true
---

# Project Spec Discovery

Before creating a new project, gather the user's preferences through a short interactive discovery phase. This produces a **Project Spec** that guides all subsequent design and development decisions.

The goal is a conversation, not a form — friendly, quick, and easy to skip through.

## How to Run

Gather preferences through 5 rounds. Keep it concise and conversational.

**AskUserQuestion constraints**: Each call supports 1-4 questions, each with 2-4 options. An "Other" free-form option is automatically provided by the system — do NOT add one yourself. Keep option labels short (1-5 words). Only use AskUserQuestion for questions that have meaningful predefined options. For open-ended questions, just ask in your text output — the user will type their answer in the prompt.

### Round 1 — Name

"What's your project called?" Ask in your text output. **Stop here and wait for their reply** — do NOT call any tools or continue to the next round. The user needs a chance to type their answer.

### Round 2 — Goals & Context

"Tell me more about it." Ask about:
- What the project is for (portfolio, business, blog, app, etc.)
- Who it's for (audience)
- Any reference URLs or images the user wants to share
- General goals ("I want people to book appointments", "I want to showcase my work")

This can be one open-ended question or a short back-and-forth. Encourage URLs and images but don't require them. **Stop and wait for their reply.**

### Round 3 — Structure

Use AskUserQuestion:
- One-page or multi-page? (e.g., single scrollable page with sections vs. separate pages for each area)

### Round 4 — Stack

"How should we build it?" Use AskUserQuestion:
- **WordPress theme** *(recommended)* — Full WordPress with blocks and the editor
- **React + WordPress** — React handles the frontend, WordPress powers the backend
- **Vue + WordPress** — Vue handles the frontend, WordPress powers the backend
- **Whatever works best** — We'll pick the best approach for your project

"Whatever works best" should be the default/first option. Most users will accept it. Power users who want a specific stack can choose explicitly.

### Round 5 — Tone & Style

"What should it feel like?" Ask about:
- Visual tone (minimal, bold, playful, corporate, editorial, etc.)
- Any brand colors, fonts, or existing visual identity
- Inspirations ("I like how Stripe's site feels", "something like a magazine")

Ask in your text output. **Stop and wait for their reply.**

## Content Strategy

Generate contextually appropriate content based on the spec — real-ish copy that matches the project's purpose and tone, not lorem ipsum. During the design iteration phase, ask for content feedback:
- "How does the content feel? Is this the right tone?"
- "What are we missing?"
- "Is this the right story for your homepage?"

Use relevant stock photos for imagery based on the project description.

## After Gathering Answers

**CRITICAL: You MUST generate design previews before building anything.** Do NOT skip to `site_create` or theme building.

### Design Preview Phase

1. **Generate 2-3 design directions** as polished standalone HTML/CSS/JS files. Each should be a complete, impressive mockup — not a wireframe. Use real-ish content based on the spec.

2. **Write each option** as a standalone `.html` file using the `file_write` tool. Store them in `~/Studio/previews/` folder. Each file should be self-contained with inline CSS and any JS needed.

3. **Show the previews in the browser panel** using the `browser_navigate` tool with the **full absolute file path** to the HTML file (e.g. `browser_navigate("/Users/shaun/Studio/previews/option-a.html")`). The file will be served via a local HTTP server automatically. Navigate to the first option immediately, then tell the user about all options and how to switch between them. Create an `index.html` that shows all options side-by-side using iframes, and navigate to that.

4. **Tell the user** you've created the design options and describe each direction briefly. Ask them to pick one, iterate, or mix elements.

4. **Wait for the user to commit** before building. They should explicitly say "build it" or pick an option. Until then, iterate on the designs based on feedback.

5. **Only after the user commits** to a design direction should you proceed to `site_create` and theme building.

### Speed Strategy

Generate a quick "style tile" first — just a hero section showing the color palette, typography, and layout direction. Then build out full mockups while the user reacts to the tiles.

## When to Skip Discovery

Do NOT ask questions if:
- The user already provided enough detail in the initial prompt to start designing. Proceed directly.
- The user says "just build something" or "surprise me". Pick a bold creative direction yourself and proceed.
- The user explicitly asks to skip the setup or says they don't want questions.

If the user provides partial info, only ask about what's missing — don't repeat questions they've already answered.
