import fs from 'fs';
import path from 'path';

const AGENTS_MD_FILENAME = 'AGENTS.md';

const AGENTS_MD_TEMPLATE = `# AI Instructions

This is a local WordPress site managed by [WordPress Studio](https://developer.wordpress.com/studio/), a free desktop app for local WordPress development. Studio uses [WordPress Playground](https://wordpress.github.io/wordpress-playground/) (PHP WASM) as its runtime.

## Managing This Site

Use the Studio CLI to manage this site. All \`studio\` commands accept a \`--path <dir>\` flag to target a specific site; when run from the site root, the path is detected automatically.

**Site lifecycle:**
\`\`\`bash
studio site start          # Start the WordPress server
studio site stop           # Stop the WordPress server
studio site status         # Show URL, admin credentials, PHP/WP versions
studio site set --php 8.3  # Change PHP version
studio site set --wp 6.8   # Update WordPress version
\`\`\`

**Run WP-CLI commands:**
\`\`\`bash
studio wp <wp-cli-command>
# Examples:
studio wp plugin list
studio wp plugin install woocommerce --activate
studio wp theme activate twentytwentyfive
studio wp post create --post_title="Hello" --post_status=publish
studio wp eval 'echo get_bloginfo("name");'
studio wp db query "SELECT * FROM wp_options WHERE option_name='blogname';"
\`\`\`

Note: \`wp shell\` is not supported. Always use \`studio wp\` rather than a standalone \`wp\` binary — Studio runs WordPress through PHP WASM and WP-CLI must go through the same runtime.

**Cloud preview sites** (requires \`studio auth login\`):
\`\`\`bash
studio preview create   # Upload site to a temporary WordPress.com preview URL
studio preview list     # List existing preview sites
studio preview update   # Re-upload and refresh a preview site
studio preview delete   # Remove a preview site
\`\`\`

**Authentication:**
\`\`\`bash
studio auth login   # Authenticate with WordPress.com (opens browser)
studio auth status  # Check authentication status
studio auth logout  # Clear stored credentials
\`\`\`

## WordPress Development Best Practices

**Themes and plugins:** Add custom themes to \`wp-content/themes/\` and plugins to \`wp-content/plugins/\`. To customise an existing theme, create a child theme rather than modifying the parent directly.

**Use hooks, not direct edits:** Extend WordPress via actions and filters. Avoid editing core files — Studio runs on WordPress Playground and core changes will not persist correctly across server restarts.

\`\`\`php
// Correct: extend via hooks
add_action( 'wp_enqueue_scripts', function () {
    wp_enqueue_style( 'my-theme', get_stylesheet_uri() );
} );

// Incorrect: do not edit wp-includes/ or wp-admin/ directly
\`\`\`

**Data handling:** Always sanitize input and escape output.
- Sanitize: \`sanitize_text_field()\`, \`absint()\`, \`wp_kses_post()\`
- Escape: \`esc_html()\`, \`esc_attr()\`, \`esc_url()\`, \`wp_kses()\`
- Database: use \`$wpdb->prepare()\` for all queries with dynamic values

**Options and metadata:** Use the WordPress Options API (\`get_option\` / \`update_option\`) and post/user/term meta APIs rather than direct database queries wherever possible.

**\`wp-config.php\`:** Studio strips the default MySQL \`DB_*\` constants (\`DB_NAME\`, \`DB_USER\`, \`DB_PASSWORD\`, \`DB_HOST\`) from \`wp-config.php\` — do not add them back. The database connection is handled by the SQLite integration (see below).

## Database: SQLite (not MySQL)

Studio uses **SQLite** as the WordPress database backend via the [SQLite Database Integration](https://wordpress.org/plugins/sqlite-database-integration/) plugin. There is no MySQL server.

**File locations:**
- Integration plugin: \`wp-content/mu-plugins/sqlite-database-integration/\`
- WordPress database drop-in: \`wp-content/db.php\` ← do not modify or delete
- SQLite database file: \`wp-content/database/.ht.sqlite\`

**Querying the database directly:**
\`\`\`bash
studio wp db query "SELECT option_name, option_value FROM wp_options LIMIT 10;"
\`\`\`

**SQLite limitations to be aware of:**
- No stored procedures or user-defined functions
- No \`FULLTEXT\` index support (use a search plugin instead)
- Some MySQL-specific functions are unavailable (\`GROUP_CONCAT\` with \`ORDER BY\`, \`REGEXP\`, date-formatting functions)
- \`ALTER TABLE\` support is limited — use \`dbDelta()\` for schema changes in plugins
- The \`utf8mb4\` charset referenced in older code is irrelevant; SQLite handles encoding natively

**Best practices for SQLite-compatible code:**
- Use \`$wpdb->prepare()\` and the WordPress database abstraction layer — avoid raw MySQL syntax
- Use \`dbDelta()\` (from \`wp-admin/includes/upgrade.php\`) to create or alter tables in plugins
- Do not reference \`DB_NAME\`, \`DB_HOST\`, \`DB_USER\`, or \`DB_PASSWORD\` constants — they are not defined
- If a plugin checks for MySQL and refuses to activate, it may not be compatible with this site

## Studio-Specific Notes

**WordPress core:** Do not modify files inside \`wp-includes/\` or \`wp-admin/\`. Studio sites run on WordPress Playground (PHP WASM), and core changes will not persist as expected.

**Must-use plugins:** The \`wp-content/mu-plugins/\` directory contains the SQLite integration. Do not remove files from this directory. You can add your own mu-plugins alongside the existing ones.

**Port and URL:** The local URL and port are assigned dynamically by Studio. Always retrieve the current URL with \`studio site status\` rather than hardcoding it.

**Multisite:** WordPress Multisite is not supported in Studio sites.

**Persistence:** The site runs in-process using PHP WASM. File writes to \`wp-content/\` persist to disk normally. Server-side cron is emulated; long-running background processes are not supported.
`;

/**
 * Writes the default AGENTS.md file to the site root if one does not already exist.
 * The file guides AI coding agents toward Studio CLI commands, WordPress best practices,
 * and SQLite-specific conventions for sites managed by Studio.
 *
 * Skips writing if an AGENTS.md already exists so user-customised files are preserved.
 */
export async function writeAgentsMd( sitePath: string ): Promise< void > {
	const agentsMdPath = path.join( sitePath, AGENTS_MD_FILENAME );
	if ( fs.existsSync( agentsMdPath ) ) {
		return;
	}
	await fs.promises.writeFile( agentsMdPath, AGENTS_MD_TEMPLATE, 'utf-8' );
}
