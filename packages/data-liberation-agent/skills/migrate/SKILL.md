---
name: migrate
disable-model-invocation: true
description: Alias for `/liberate`. Migrate a website or an owned local directory into WordPress — point it at a URL (a live site you don't control) or at a local folder of HTML/CSS/JS you own, and it runs the full liberate pipeline (route on input → detect/discover/extract/capture + reconstruct for URLs; provision Studio + carry-to-block-theme for local dirs). Use `/migrate <url-or-dir>` exactly like `/liberate <url-or-dir>`.
---

# Migrate a website (alias for /liberate)

This skill is a **thin alias** for `/liberate`. It owns no workflow of its own — `liberate/SKILL.md` is the single source of truth.

**To run it:** read & follow `skills/liberate/SKILL.md` inline in this same shared context, treating the input passed to `/migrate` (the URL or local directory) exactly as `/liberate`'s input. Do everything that skill says — including its "Step R — Route on input type" branch (local directory → dispatch `liberate-local`; URL → the remote detect/discover/checkpoint/extract path).

That's the whole skill: dispatch to `liberate` and execute its workflow.
