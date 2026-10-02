---
name: wordpress-studio
description: Build, design, redesign, and manage websites with WordPress Studio (the wordpress-studio MCP tools), which runs them on the user's computer as WordPress sites. Use whenever the user asks for a local site or a site on their computer, a WordPress site, or a Studio site — a website, landing page, blog, portfolio or store — to change one of their Studio or WordPress.com sites (design, content, theme, plugins), to preview it, or to publish it to WordPress.com.
---

# WordPress Studio

WordPress Studio runs WordPress sites locally and gives you its site-building tools through the `wordpress-studio` MCP server.

1. Call the `studio_instructions` tool before your first site task and follow what it returns for the rest of the session: it is the Studio workflow, including when to load each Studio skill with the `Skill` tool.
2. Manage sites only with the Studio tools (`site_create`, `site_start`, `wp_cli`, …); never run `wp` or start servers from the shell. Edit the site's theme and plugin files with your own file tools.
3. When you start building or redesigning a site, offer `open_studio_ui` so the user can watch the site in their browser while you work.

If the `wordpress-studio` tools are missing, the Studio CLI is probably still installing (the plugin installs it on first start) or failed to: run `curl -fsSL https://wordpress.studio/install.sh | bash` in your shell, then ask the user to start a new session.
