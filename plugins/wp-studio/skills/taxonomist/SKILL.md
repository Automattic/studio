---
name: taxonomist
description: Analyze and optimize a WordPress site's category taxonomy. Exports all posts, uses AI to suggest an improved category structure — merging duplicates, retiring dead categories, creating missing ones, writing descriptions, and re-categorizing posts. Run this when the user wants to clean up or improve their categories.
---

1. If you have not called the `studio_instructions` tool in this conversation yet, call it first and follow what it returns for the rest of the session.
2. Then call `studio_instructions` with `skill: "taxonomist"` and follow the runbook it returns.

If the `wordpress-studio` tools are missing, WordPress Studio did not start: ask the user to restart the app, and to reinstall the plugin if the tools are still missing.
