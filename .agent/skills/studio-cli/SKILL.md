---
name: studio-cli
description: Use the Studio CLI to manage local WordPress sites, authentication, and preview sites.
---

# Studio CLI

The `studio` command manages local WordPress sites powered by WordPress Playground.

## Global Options

- `--path <dir>` — Target site directory (default: current directory)
- `--help` — Show help for any command
- `--version` — Show version

## Site Management

```bash
studio site create    # Create a new site (interactive prompts or flags)
studio site list      # List all sites (--format table|json)
studio site status    # Show site details (--format table|json)
studio site start     # Start a site (--skip-browser, --skip-log-details)
studio site stop      # Stop a site (--all to stop all)
studio site delete    # Delete a site (--files to trash site files)
studio site set       # Update site settings
```

### Creating a site

```bash
studio site create --name "My Site" --path ~/Studio/my-site
```

Key options: `--name`, `--wp` (version), `--php` (version), `--domain`, `--https`, `--blueprint` (JSON file path/URL), `--admin-username`, `--admin-password`, `--admin-email`, `--start` (default: true), `--skip-browser`.

Without flags, the CLI prompts interactively for site name, path, WP/PHP versions, and domain.

### Configuring a site

```bash
studio site set --path ~/Studio/my-site --php 8.4
studio site set --path ~/Studio/my-site --domain mysite.local --https
studio site set --path ~/Studio/my-site --xdebug
```

Options: `--name`, `--domain`, `--https`, `--php`, `--wp`, `--xdebug`, `--admin-username`, `--admin-password`, `--admin-email`, `--debug-log`, `--debug-display`.

## Authentication

Required for preview site commands.

```bash
studio auth login     # Opens browser for WordPress.com OAuth, prompts for token
studio auth logout    # Revoke and clear stored token
studio auth status    # Check login status
```

## Preview Sites

Upload a local site as a temporary preview on WordPress.com.

```bash
studio preview create              # Create preview from site at --path
studio preview list                # List previews (--format table|json)
studio preview update <host>       # Update existing preview (--overwrite to change source dir)
studio preview delete <host>       # Delete a preview site
```

## WP-CLI

Run WP-CLI commands inside the site's PHP WASM environment:

```bash
studio wp --path ~/Studio/my-site core version
studio wp --path ~/Studio/my-site plugin list
studio wp --path ~/Studio/my-site user list
```

## Tips

- Use `--path` to target a specific site directory, or `cd` into the site folder first.
- Use `--format json` on `site list`, `site status`, and `preview list` for machine-readable output.
- Run `studio <command> --help` to see all options for any command.
