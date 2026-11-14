# Agent Skills in WordPress Studio

Agent Skills give your AI coding agent specialized knowledge about WordPress development. WordPress Studio bundles a set of skills you can install into your sites so agents like Claude Code or Cursor pick them up automatically.

## [What are Agent Skills?](#0-what-are-agent-skills-)

An Agent Skill is a `SKILL.md` file that tells the agent how to approach a specific area of WordPress development. When a skill is installed in a site, the agent reads it and applies the guidance it contains before starting work.

You can use skills to help agents handle tasks like:

-   Building a custom block with the correct `block.json` structure
-   Creating a plugin that follows WordPress coding standards and security practices
-   Working with REST API routes and authentication

## [Available skills in WordPress Studio](#1-available-skills-in-studio)

WordPress Studio ships with the following built-in skills:

-   **WordPress Studio CLI**: WordPress development workflows using WordPress Studio CLI
-   **Plugin Development**: Hooks, settings API, security, and packaging
-   **Block Development**: `block.json`, attributes, rendering, and deprecations
-   **Block Themes**: `theme.json`, templates, patterns, and style variations
-   **REST API**: Routes, endpoints, schema, and authentication
-   **WP-CLI & Ops**: CLI commands, automation, and search-replace

## [Where skills are stored](#2-where-skills-are-stored)

WordPress Studio copies each installed skill into `.agents/skills/<skill-id>` in your site directory. It also creates a link for each skill in `.claude/skills/` so Claude Code can find it. This example shows all six installed skills and the Claude Code link for `studio-cli`.

```text
my-site/
├── .agents/
│   └── skills/
│       ├── studio-cli/
│       │   └── SKILL.md
│       ├── wp-block-development/
│       ├── wp-block-themes/
│       ├── wp-plugin-development/
│       ├── wp-rest-api/
│       └── wp-wpcli-and-ops/
├── .claude/
│   └── skills/
│       └── studio-cli → ../../.agents/skills/studio-cli
├── wp-admin/
├── wp-content/
├── wp-includes/
└── wp-config.php
```

## [Installing and removing skills in WordPress Studio](#3-installing-and-removing-skills-in-studio)

There are two ways to manage skills in WordPress Studio – globally and per site.

You can find the global settings for skills in **Settings → Skills**. Open **Settings** from the account menu at the bottom of the sidebar, or press ⌘, (Ctrl+, on Windows and Linux), and select the **Skills** page.

From that page you can:

-   Turn on **WordPress skills** to install every available skill at once
-   Turn on the toggle next to an individual skill to install it
-   Turn off the toggle next to an installed skill to uninstall it

Installing or removing a skill applies to all existing sites immediately. Any new site you create will also receive the currently installed skills automatically.

To manage skills for a single site, open that site’s settings (choose **Settings** from the site menu) and select the **Skills** page, or click **Manage skills for this site** in **Settings → Skills**. Turn **WordPress skills** on or off for the site, and use the menu next to each installed skill to open it or **Uninstall** it. Changes there apply only to that site, and turning skills off keeps their files and any edits you made to them.
