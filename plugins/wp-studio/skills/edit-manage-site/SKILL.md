---
name: edit-manage-site
description: Edit and manage one of the user's local Studio sites — answer questions about it, add pages or sections, adjust the design, add features and plugins, update content, preview it, or publish it. Load it first for any work on an existing local site that is not a full build or redesign.
---

1. If you have not called the `studio_instructions` tool in this conversation yet, call it first and follow what it returns for the rest of the session.
2. Then call `studio_instructions` with `skill: "edit-manage-site"` and follow the runbook it returns.

If the `wordpress-studio` tools are missing, WordPress Studio did not start: ask the user to restart the app, and to reinstall the plugin if the tools are still missing.
