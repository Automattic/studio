---
name: hosting-plans-helper
description: Answer WordPress.com plan and feature-tier questions (plan names and what each tier includes — plugins, themes, custom code, SSH, hosting) from authoritative live data. Load before answering ANY plan or feature-gating question; never answer these from memory.
---

1. If you have not called the `studio_instructions` tool in this conversation yet, call it first and follow what it returns for the rest of the session.
2. Then call `studio_instructions` with `skill: "hosting-plans-helper"` and follow the runbook it returns.

If the `wordpress-studio` tools are missing, WordPress Studio did not start: ask the user to restart the app, and to reinstall the plugin if the tools are still missing.
