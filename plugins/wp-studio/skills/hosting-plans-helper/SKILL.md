---
name: hosting-plans-helper
description: Answer WordPress.com plan, pricing, upgrade, and feature-tier questions (plan names, what each tier unlocks — plugins, themes, custom code, SSH, hosting — and current prices) from authoritative live data. Load before answering ANY plan, pricing, or feature-gating question; never answer these from memory.
---

1. If you have not called the `studio_instructions` tool in this conversation yet, call it first and follow what it returns for the rest of the session.
2. Then call `studio_instructions` with `skill: "hosting-plans-helper"` and follow the runbook it returns.

If the `wordpress-studio` tools are missing in a regular Claude chat, WordPress Studio cannot run there: ask the user to use it from Claude Code, or from a Cowork task on their computer. Otherwise it did not start: ask the user to restart the app, and to reinstall the plugin if the tools are still missing.
