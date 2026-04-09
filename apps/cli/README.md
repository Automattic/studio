# WordPress Studio CLI

`wp-studio` is the standalone, CLI-only version of [WordPress Studio](https://developer.wordpress.com/studio/) – a fast, free, open source tool for local WordPress development all powered by WordPress Playground and WordPress.com.

If you already have Studio installed, then the easiest way to use the CLI is to open Studio, go to the settings modal and ensure that the "Studio CLI" toggle is enabled.

The Studio CLI lets you:

- Create, run, and manage local WordPress sites from the terminal.
- Run WP-CLI commands.
- Import and export site backups.
- Pull from and push to WordPress.com sites.
- Publish ephemeral preview sites to share (requires WordPress.com login).
- Integrate with AI coding agents. Every site comes with an `AGENTS.md` file.

![WordPress Studio CLI demo](./assets/demo.gif)

# Table of contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Import and export](#import-and-export)
- [Sync with WordPress.com and Pressable](#sync-with-wordpresscom-and-pressable)
- [Preview sites](#preview-sites)

## Requirements

`wp-studio` runs best on Node.js 24 or higher, which supports more recent V8 WASM APIs. Node.js 22 or higher is required. You can download the appropriate version from the [Node.js website](https://nodejs.org/en/download).

## Installation

Run without installing:

```bash
npx wp-studio@latest --help
```

Install globally:

```bash
npm install -g wp-studio
studio --help
```

## Quick start

From anywhere on your system, run the following command to create a new WordPress site (with a step-by-step guide):

```bash
studio site create
```

## Usage

The Studio CLI integrates with Studio and uses the same list of sites. Similarly to Studio, the Studio CLI also runs sites in the background. To see the list of sites under management by Studio and their current status, run the command:

```bash
studio site list
```

To start and stop sites, run these commands:

```bash
studio site start --path ~/Studio/my-site
studio site stop --path ~/Studio/my-site
```

Run WP-CLI commands in a site:

```bash
studio wp plugin list --path ~/Studio/my-site
studio wp option get home --path ~/Studio/my-site
```

## Import and export

The Studio CLI allows you to import and export local backups.

When exporting, choose either a full-site backup as a `.zip` or `.tar.gz` file, or a database-only backup as a `.sql` file.

For imports, backup files from your WordPress.com site or from Jetpack’s Activity Log page are supported. So are `.wpress` files and `.zip` files from WordPress Playground or Local. For more details, see the [documentation](https://developer.wordpress.com/docs/developer-tools/studio/import-export/).

```bash
studio export --path ~/Studio/my-site
studio export --path ~/Studio/my-site --mode db
studio import ~/Backups/my-site-backup.zip --path ~/Studio/my-site
```

## Sync with WordPress.com and Pressable

You can pull from and push to remote sites on both WordPress.com and Pressable. Both commands support selective sync, so you can decide which files to sync and whether to include the database.

```bash
studio pull --path ~/Studio/my-site
studio push --path ~/Studio/my-site
```

## Preview sites

The Studio CLI lets you share your work through preview sites. These are powered by WordPress.com on a temporary domain (wp.build), and they allow you to share snapshots of your local sites with clients or team members.

To publish preview sites, you need to first authenticate with WordPress.com:

```bash
studio auth login
```

Publish a preview with this command:

```bash
studio preview create --path ~/Studio/my-site
```
