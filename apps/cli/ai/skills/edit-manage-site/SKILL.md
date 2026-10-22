---
name: edit-manage-site
description: Edit and manage one of the user's local Studio sites — answer questions about it, add pages or sections, adjust the design, add features and plugins, update content, preview it, or publish it. Load it first for any work on an existing local site that is not a full build or redesign.
user-invokable: true
---

# Edit and Manage a Site

Use this skill for work on an existing local Studio site. A new site, a redesign, or a rebuild uses the `build-site` skill instead, and the user's WordPress.com sites use the `edit-manage-remote-site` skill.

## 1. Settle the site

Work on the one site the request is about, and start it with site_start if it is not running. When the Active site section names a design system (DESIGN.md), read it before any design or content work — pages, posts, patterns, images, or copy — and follow it. A change to the look updates DESIGN.md in the same turn.

## 2. Make the change

For any change to content, templates, or the theme, load the `visual-design` skill first, along with the other skills the change calls for (the Skills list names them). Follow the site's existing look — its DESIGN.md and active theme — rather than redesigning it: the catalogs and design picks in `visual-design` are for builds. Then:

- Before editing an existing theme's template or part, check for a copy saved in the Site Editor (`post list --post_type=wp_template,wp_template_part`): WordPress renders that saved copy instead of the file, so if one exists, make the change in the saved copy too, keep the user's other edits, and tell the user.
- Change an installed third-party theme only through a child theme, following the `block-content` skill's theme-file rules.
- Validate every template, part, and piece of content you write with validate_blocks before it reaches the site.

## 3. Check and report

Take one screenshot of the page you changed and compare it with what you intended; fix real defects. For a larger visual change, load the `visual-polish` skill instead. Then tell the user what changed and where to see it.

To share or publish the site, preview_create makes a temporary preview site, and site_push publishes it to WordPress.com (its description says how to confirm the target).
