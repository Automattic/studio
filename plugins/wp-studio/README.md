# WordPress Studio plugin

Build, design, and manage WordPress sites from Codex in the ChatGPT app, or from Claude Code, with
[WordPress Studio](https://developer.wordpress.com/studio/). Ask for a site and Studio creates it on
your computer, asks about the look and the layout with rendered previews, builds a block theme, and
checks the result visually. Publish it to WordPress.com when you are ready.

## Install

In Codex:

```bash
codex plugin marketplace add Automattic/studio-plugins
codex plugin add wp-studio@studio
```

Restart the ChatGPT app afterwards.

In Claude Code:

```bash
claude plugin marketplace add Automattic/studio-plugins
claude plugin install wp-studio@studio
```

Claude Code runs the plugin with the Node.js on your `PATH`, version 22 or later. Any other MCP client can run the server directly: add a stdio
server named `wordpress-studio` that runs `studio mcp`.

## Use

Ask: **Build a WordPress site for my bakery.**

In the ChatGPT app, open **WordPress** from the sidebar to see your local Studio sites and your WordPress.com sites. Each
site has its own page: start or stop it, open WP Admin, run a speed or SEO audit, pull a live site
into Studio, or log in to WordPress.com.

## The Studio CLI

The plugin carries the Studio CLI. It unpacks it the first time it starts, which takes a few
seconds, or a minute or two on Windows, and it updates with the plugin. A Studio CLI from the
desktop app or from npm is used instead when it is at least as recent. Like any Studio CLI outside
the desktop app, it downloads PHP when it first starts a site.

## Telemetry

The plugin itself sends no telemetry. The Studio CLI sends anonymous usage events to Automattic
(Tracks), tied to a random install ID rather than to you or your WordPress.com account, plus
anonymous usage counters. To turn the usage events off, set `"analyticsOptOut": true`
in `~/.studio/shared.json`, or switch off analytics in the Studio desktop app's settings. See the
[privacy policy](https://automattic.com/privacy/) and the
[terms of service](https://wordpress.com/tos/).
