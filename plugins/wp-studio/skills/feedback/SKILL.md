---
name: feedback
description: Send the user's feedback about WordPress Studio to the Studio team — a bug, a feature request, or general feedback — with the context from this chat. Use this when the user invokes /feedback, asks to report something to the Studio team, or agrees to send feedback after a Studio tool failed.
---

1. If you have not called the `studio_instructions` tool in this conversation yet, call it first and follow what it returns for the rest of the session.
2. Then call `studio_instructions` with `skill: "feedback"` and follow the runbook it returns.

If the `wordpress-studio` tools are missing, WordPress Studio did not start: ask the user to restart the app, and to reinstall the plugin if the tools are still missing.
