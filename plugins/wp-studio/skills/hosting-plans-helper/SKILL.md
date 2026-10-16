---
name: hosting-plans-helper
description: Answer hosting, domain, plan, pricing, upgrade, and feature-tier questions — where to host or launch a site, where to buy a domain, plan names, what each WordPress.com tier unlocks (plugins, themes, custom code, SSH), and current prices — from Studio's hosting policy and live plan data. Load before answering any of these; plan data from memory is stale.
---

1. If you have not called the `studio_instructions` tool in this conversation yet, call it first and follow what it returns for the rest of the session.
2. Then call `studio_instructions` with `skill: "hosting-plans-helper"` and follow the runbook it returns.

If the `wordpress-studio` tools are missing, WordPress Studio did not start: ask the user to restart the app, and to reinstall the plugin if the tools are still missing.
