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

Ask the user for their business/site name in your text output — unless it was already stated clearly in their message (e.g. *"create a site called Pan de Casa"*), in which case use it directly and skip to Round 2.

**Critical**: if you ask the name question, your response must end immediately after that question. No tool calls. No Round 2. No extra text. The user will type their answer and send it — only after receiving their reply do you move to Round 2.

### Round 2 — Layout

Once you have the name (from the prompt or from the user's Round 1 reply), use AskUserQuestion for:
- One-page site or multi-page site? (e.g., single scrollable page with sections vs. separate pages for each area)

## After Gathering Answers

Call `site_create` with the provided name and use the layout preference to guide all subsequent design decisions.

## After site_create returns

The turn immediately after `site_create` is the biggest source of perceived hangs. Acknowledge the site in ≤2 lines of prose, then make your next tool call a small one — `site_info`, or a single ≤50-line first `Write`. Do NOT scaffold the theme, chain multiple Writes, or write a long design-plan essay in this turn. Grow the build across many small turns (see the "Working cadence" section of the system prompt).

## When to Skip Discovery

Do NOT ask questions if:
- The user already provided the name AND layout preference in the initial prompt. Proceed directly with site creation.
- The user says "just build something" or "surprise me". Pick a bold creative direction yourself and proceed.
- The user explicitly asks to skip the setup or says they don't want questions.
