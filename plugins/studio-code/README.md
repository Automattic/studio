# WordPress Studio plugin

Build, design, and manage WordPress sites from Codex in the ChatGPT app with
[WordPress Studio](https://developer.wordpress.com/studio/). Ask for a site and Studio creates it on
your computer, asks about the look and the layout with rendered previews, builds a block theme, and
checks the result visually. Publish it to WordPress.com when you are ready.

## Install

```bash
codex plugin marketplace add Automattic/studio
codex plugin add studio-code@studio
```

The **WordPress** tab in the sidebar needs two Codex features that are still in development:

```bash
codex features enable mcp_2026_07_28
codex features enable codex_apps_mcp_2026_07_28
```

Restart the ChatGPT app afterwards. Any other MCP client can run the server directly: add a stdio
server named `wordpress-studio` that runs `studio mcp`.

## Use

Ask Codex: **Build a WordPress site for my bakery.**

Open **WordPress** from the sidebar to see your local Studio sites and your WordPress.com sites. Each
site has its own page: start or stop it, open WP Admin, run a speed or SEO audit, pull a live site
into Studio, or log in to WordPress.com.

## The Studio CLI

The plugin runs the Studio CLI. If you have none, it installs one into `~/.studio` the first time it
starts (a download of about 250 MB) and shows the progress in the WordPress page. It keeps that
install up to date: new versions are installed in the background and swapped in while no site is
running. A Studio CLI from the desktop app or from npm is used as is; those update on their own.

## Telemetry

The plugin itself sends no telemetry. The Studio CLI sends anonymous usage events to Automattic
(Tracks), tied to a random install ID rather than to you or your WordPress.com account, plus
anonymous usage counters. To turn the usage events off, set `"analyticsOptOut": true`
in `~/.studio/shared.json`, or switch off analytics in the Studio desktop app's settings. See the
[privacy policy](https://automattic.com/privacy/) and the
[terms of service](https://wordpress.com/tos/).
