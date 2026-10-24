---
name: build-site
description: Create, build, design, redesign, or rebuild a whole website as a WordPress site with WordPress Studio, on the user's computer — pick or create the site, settle the design and plugins as a Site Spec, then build the theme, provision the site, and publish the content. Load it before picking or creating the site.
---

1. If you have not called the `studio_instructions` tool in this conversation yet, call it first and follow what it returns for the rest of the session.
2. Then call `studio_instructions` with `skill: "build-site"` and follow the runbook it returns.

If the `wordpress-studio` tools are missing, WordPress Studio did not start: ask the user to restart the app, and to reinstall the plugin if the tools are still missing.
