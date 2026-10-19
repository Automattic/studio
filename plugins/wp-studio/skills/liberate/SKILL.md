---
name: liberate
description: Liberate any website into a portable HTML copy and import it into WordPress using the Studio CLI. Then work with the user to make sure it looks and function like the original. Use this when the user wants to migrate, import, move, liberate, or rebuild a website from a URL.
---

1. If you have not called the `studio_instructions` tool in this conversation yet, call it first and follow what it returns for the rest of the session.
2. Then call `studio_instructions` with `skill: "liberate"` and follow the runbook it returns.

If the `wordpress-studio` tools are missing in a regular Claude chat, WordPress Studio cannot run there: ask the user to use it from Claude Code, or from a Cowork task on their computer. Otherwise it did not start: ask the user to restart the app, and to reinstall the plugin if the tools are still missing.
