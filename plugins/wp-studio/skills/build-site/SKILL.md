---
name: build-site
description: Create a new WordPress site with WordPress Studio on the user's computer, or build, design, redesign, or rebuild a whole website as one. Load it first for any request to create a site, also when the request goes on to ask for a single page, section, or feature: it picks or creates the site, settles the design and plugins as a Site Spec, then scaffolds the theme, provisions the site, validates and publishes the content, and polishes the result.
---

1. If you have not called the `studio_instructions` tool in this conversation yet, call it first and follow what it returns for the rest of the session.
2. Then call `studio_instructions` with `skill: "build-site"` and follow the runbook it returns.

If the `wordpress-studio` tools are missing, WordPress Studio did not start: ask the user to restart the app, and to reinstall the plugin if the tools are still missing.
