# Agent Skills in WordPress Studio

Agent Skills give your AI coding agent specialized knowledge about WordPress development. Studio bundles a set of skills you can install into your sites so agents like Claude Code or Cursor pick them up automatically.

## [What are Agent Skills?](#0-what-are-agent-skills-)

An Agent Skill is a `SKILL.md` file that tells the agent how to approach a specific area of WordPress development. When a skill is installed in a site, the agent reads it and applies the guidance it contains before starting work.

You can use skills to help agents handle tasks like:

-   Building a custom block with the correct `block.json` structure
-   Creating a plugin that follows WordPress coding standards and security practices
-   Working with REST API routes and authentication

## [Available skills in Studio](#1-available-skills-in-studio)

Studio ships with the following built-in skills:

-   **Studio CLI**: WordPress development workflows using Studio CLI
-   **Plugin Development**: Hooks, settings API, security, and packaging
-   **Block Development**: `Block.json`, attributes, rendering, and deprecations
-   **Block Themes**: Theme.json, templates, patterns, and style variations
-   **REST API** — Routes, endpoints, schema, and authentication
-   **WP-CLI & Ops** — CLI commands, automation, and search-replace

## [Where skills are stored](#2-where-skills-are-stored)

When a skill is installed, Studio copies it into the site directory:

![Folder structure of a web development project showing directories and files related to WordPress, including 'wp-config.php' and various folders like 'skills' and 'studio-cli'.](https://developer.wordpress.com/wp-content/uploads/2026/04/image-6.png?w=624)

For agents that use Claude’s directory layout, Studio also creates a symlink at `.claude/skills/\<skill-id>` pointing to the same location. No additional configuration is needed for Claude Code to pick up the skill.

## [Installing and removing skills in Studio](#3-installing-and-removing-skills-in-studio)

There are two ways to manage skills in Studio – globally and per site.

You can find the global settings for skills in **App settings → Skills**. Open **App settings** from the bottom of the sidebar, or press ⌘, (Ctrl+, on Windows and Linux), and select the **Skills** tab:

[![](https://developer.wordpress.com/wp-content/uploads/2026/04/app-settings-skills.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2026/04/app-settings-skills.png)

From that screen you can:

-   Turn on the toggle next to an individual skill to install it
-   Click **Install all** to install every available skill at once
-   Turn off the toggle next to an installed skill to uninstall it

Installing or removing a skill applies to all existing sites immediately. Any new site you create will also receive the currently installed skills automatically.
