---
name: annotate
description: Open a browser with visual annotation tools. The user clicks elements on their site and leaves feedback — the agent reads annotations and makes changes. Use this when the user wants to point at specific elements to fix, tweak, or redesign.
---

1. If you have not called the `studio_instructions` tool in this conversation yet, call it first and follow what it returns for the rest of the session.
2. Then call `studio_instructions` with `skill: "annotate"` and follow the runbook it returns.

If the `wordpress-studio` tools are missing in a regular Claude chat, WordPress Studio cannot run there: ask the user to use it from Claude Code, or from a Cowork task on their computer. Otherwise it did not start: ask the user to restart the app, and to reinstall the plugin if the tools are still missing.
