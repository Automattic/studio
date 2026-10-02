---
name: wordpress-studio
description: Build, design, redesign, and manage local WordPress sites with WordPress Studio (the wordpress-studio MCP tools). Use whenever the user wants to create or build a WordPress site, a landing page or blog, change a site's design, content, theme or plugins, preview it, or publish it to WordPress.com.
---

# WordPress Studio

WordPress Studio runs WordPress sites locally and gives you its site-building tools through the `wordpress-studio` MCP server.

1. Call the `studio_instructions` tool before your first site task and follow what it returns for the rest of the session: it is the Studio workflow, including when to load each Studio skill with the `Skill` tool.
2. Manage sites only with the Studio tools (`site_create`, `site_start`, `wp_cli`, …); never run `wp` or start servers from the shell. Edit the site's theme and plugin files with your own file tools.
3. When you start building or redesigning a site, offer `open_studio_ui` so the user can watch the site in their browser while you work.

If the `wordpress-studio` tools are missing, the Studio CLI is probably still installing (the plugin installs it on first start) or failed to: run `curl -fsSL https://wordpress.studio/install.sh | bash` in your shell, then ask the user to start a new session.
