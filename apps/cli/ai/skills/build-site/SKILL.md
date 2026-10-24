---
name: build-site
description: Create, build, design, redesign, or rebuild a whole website as a WordPress site with WordPress Studio, on the user's computer — pick or create the site, settle the look and the layout with the user, then build the theme, provision the site, and publish the content. Load it before picking or creating the site.
user-invokable: true
tools: pick_design, present_design_options, generate_images
---

# Build a Site

1. **The site**: the active site, or `site_create` when there is none or the request names another site.
2. **The design**: load the `visual-design` skill, then settle the look and the layout with `pick_design`; each result says what comes next. A site that keeps its own theme, without a request for a new look, skips the look.
3. **The theme**: a block theme in `wp-content/themes/`, or a child theme to restyle an installed theme — style.css, the picked look as theme.json, templates, parts, patterns.
4. **Provisioning**: with `wp`, activate the theme, install and activate the plugins the site's features need (the `plugin-recommendations` skill), and set options.
5. **The content**: each page's content as a scratch file in the site's `tmp/`, then the page created or updated from it.
