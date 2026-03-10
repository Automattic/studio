import fs from 'fs';
import path from 'path';

const SKILL_DIR = path.join( '.agents', 'skills', 'studio-cli' );
const SKILL_MD_FILENAME = 'SKILL.md';
const CLAUDE_SKILLS_DIR = path.join( '.claude', 'skills' );
const SYMLINK_NAME = 'studio-cli';

const SKILL_MD_TEMPLATE = `---
name: studio-cli
description: Use the Studio CLI to manage local WordPress sites, authentication, and preview sites.
---

# Studio CLI

The \`studio\` command manages local WordPress sites powered by WordPress Playground (PHP WASM).

## Global Options

- \`--path <dir>\` — Target site directory (default: current directory). Supports \`~\`.
- \`--help\` — Show help for any command
- \`--version\` — Show version

## Site Management

\`\`\`bash
studio site create    # Create a new site
studio site list      # List all sites (--format table|json)
studio site status    # Show site details (--format table|json)
studio site start     # Start a site
studio site stop      # Stop a site (--all to stop all)
studio site delete    # Delete a site (--files to trash site files)
studio site set       # Update site settings
\`\`\`

### Creating a site

\`\`\`bash
studio site create --name "My Site" --path ~/Studio/my-site
\`\`\`

**Options:** \`--name\`, \`--wp\` (default: "latest", min: 6.2.1), \`--php\` (default: 8.3, choices: 8.5/8.4/8.3/8.2/8.1/8.0/7.4), \`--domain\`, \`--https\`, \`--blueprint\` (JSON file/URL), \`--admin-username\` (default: "admin"), \`--admin-password\` (auto-generated if omitted), \`--admin-email\` (default: "admin@localhost.com"), \`--start\` (default: true, use \`--no-start\` to skip), \`--skip-browser\`, \`--skip-log-details\`.

Without flags in a TTY, the CLI prompts interactively for name, path, WP/PHP versions, and domain.

**Note:** CLI flag values are visible in process lists. Use Blueprint files for sensitive passwords.

### Checking site details

\`studio site status\` shows site URL, auto-login URL, admin credentials, PHP/WP versions, Xdebug status, and online/offline status. Prefer this over individual \`wp-cli\` calls when you need general site info.

\`\`\`bash
studio site status --path ~/Studio/my-site              # Table output
studio site status --path ~/Studio/my-site --format json # JSON output (fields: siteUrl, autoLoginUrl, sitePath, status, phpVersion, wpVersion, xdebug, adminUsername, adminPassword, adminEmail)
\`\`\`

### Configuring a site

\`\`\`bash
studio site set --path ~/Studio/my-site --php 8.4
studio site set --path ~/Studio/my-site --domain mysite.local --https
studio site set --path ~/Studio/my-site --xdebug
\`\`\`

**Options:** \`--name\`, \`--domain\` (must be unique, typically \`.local\`), \`--https\` (requires domain), \`--php\`, \`--wp\`, \`--xdebug\`, \`--admin-username\`, \`--admin-password\`, \`--admin-email\`, \`--debug-log\`, \`--debug-display\`. At least one option is required.

**Restart behavior:** Changes to domain, HTTPS, PHP, WP, Xdebug, credentials, or debug flags trigger an automatic restart if the site is running.

**Xdebug:** Only one site can have Xdebug enabled at a time.

### Starting and stopping sites

\`\`\`bash
studio site start --path ~/Studio/my-site                    # Start and open browser
studio site start --path ~/Studio/my-site --skip-browser     # Start without opening browser
studio site start --path ~/Studio/my-site --skip-log-details # Start without printing credentials
studio site stop --path ~/Studio/my-site                     # Stop current site
studio site stop --all                                       # Stop all sites
\`\`\`

### Deleting a site

\`\`\`bash
studio site delete --path ~/Studio/my-site          # Remove site record only
studio site delete --path ~/Studio/my-site --files   # Also trash site files
\`\`\`

Deleting a site also removes its associated preview sites if authenticated.

## Authentication

Required for preview site commands.

\`\`\`bash
studio auth login     # Opens browser for WordPress.com OAuth, prompts for token
studio auth logout    # Revoke and clear stored token
studio auth status    # Check login status
\`\`\`

Tokens are valid for 14 days.

## Preview Sites

Upload a local site as a temporary preview on WordPress.com. Previews expire after **7 days** and sites must be under **2 GB**.

\`\`\`bash
studio preview create              # Create preview from site at --path
studio preview list                # List previews (--format table|json)
studio preview update <host>       # Update existing preview
studio preview delete <host>       # Delete a preview site
\`\`\`

- \`preview update\` checks that the current path matches the original source site. Use \`--overwrite\` / \`-o\` to update from a different directory.
- \`preview update\` will not update expired previews.
- \`<host>\` is the preview hostname (e.g., "site.wordpress.com").

## WP-CLI

Run WP-CLI commands inside the site's PHP WASM environment:

\`\`\`bash
studio wp --path ~/Studio/my-site core version
studio wp --path ~/Studio/my-site plugin list
studio wp --path ~/Studio/my-site user list
\`\`\`

**Additional flags:**
- \`--php-version <version>\` — Run with a specific PHP version (overrides site config)
- \`--studio-no-path\` — Run global WP-CLI without site context

**Note:** \`studio wp shell\` is not supported. Use \`studio wp eval\` instead.

## Tips

- Use \`--path\` to target a specific site directory, or \`cd\` into the site folder first.
- Use \`--format json\` on \`site list\`, \`site status\`, and \`preview list\` for machine-readable output.
- Run \`studio <command> --help\` to see all options for any command.
- Custom domains require hosts file changes (may need elevated permissions on macOS/Linux).
- HTTPS uses self-signed certificates stored in platform-specific locations.
`;

/**
 * Writes the default SKILL.md file to `.agents/skills/studio-cli/SKILL.md` within the
 * site directory and creates a `.claude/skills/studio-cli` symlink pointing to it.
 *
 * Skips writing if the SKILL.md already exists so user-customised files are preserved.
 * Skips creating the symlink if it already exists.
 */
export async function writeSkillMd( sitePath: string ): Promise< void > {
	const skillDirPath = path.join( sitePath, SKILL_DIR );
	const skillMdPath = path.join( skillDirPath, SKILL_MD_FILENAME );
	const claudeSkillsPath = path.join( sitePath, CLAUDE_SKILLS_DIR );
	const symlinkPath = path.join( claudeSkillsPath, SYMLINK_NAME );

	const skillMdExists = fs.existsSync( skillMdPath );
	const symlinkExists = fs.existsSync( symlinkPath );

	if ( skillMdExists && symlinkExists ) {
		return;
	}

	if ( ! skillMdExists ) {
		await fs.promises.mkdir( skillDirPath, { recursive: true } );
		await fs.promises.writeFile( skillMdPath, SKILL_MD_TEMPLATE, 'utf-8' );
	}

	if ( ! symlinkExists ) {
		await fs.promises.mkdir( claudeSkillsPath, { recursive: true } );
		const relativeTarget = path.relative( claudeSkillsPath, skillDirPath );
		await fs.promises.symlink( relativeTarget, symlinkPath );
	}
}
