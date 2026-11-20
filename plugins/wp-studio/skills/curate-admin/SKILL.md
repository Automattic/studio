---
name: curate-admin
description: Curate a site's wp-admin for the people who run it — decide which menu items stay, add post types for repeated content, surface global settings, and choose the dashboard widgets. Use it to simplify or lock down the backend, prepare a site for handoff to a client, white-label it, or limit what a client can change. Asks whether this is for a staff account or everyone, walks through the menu, post types, settings and dashboard, then installs and verifies it.
---

1. If you have not called the `studio_instructions` tool in this conversation yet, call it first and follow what it returns for the rest of the session.
2. Then call `studio_instructions` with `skill: "curate-admin"` and follow the runbook it returns.

If the `wordpress-studio` tools are missing, WordPress Studio did not start: ask the user to restart the app, and to reinstall the plugin if the tools are still missing.
