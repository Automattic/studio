## WP-CLI in WordPress Studio

WP-CLI runs as `studio wp`, which targets this site's PHP runtime and database. A `wp` command from any WordPress skill or documentation runs the same way with `studio` in front:

- Skill says: `wp plugin install woocommerce` → Run: `studio wp plugin install woocommerce`
- Skill says: `wp db export` → Run: `studio wp db export`
- Skill says: `wp search-replace` → Run: `studio wp search-replace`

`wp shell` works here too, as `studio wp shell`.

## Prerequisites

`studio --version` shows whether the CLI is installed. If the command is not found, tell the user:

> The Studio CLI is not installed. Open the WordPress Studio desktop app, go to **Settings → General → Studio CLI for terminal**, and enable the toggle. Then open a new terminal window and try again.

## Workflow

1. **Verify CLI is available**: `studio --version` — if this fails, see Prerequisites above
2. **Check site status**: `studio status` — get URL, credentials, PHP/WP versions
3. **Ensure site is running**: `studio start --skip-browser` if needed
4. **Make changes**: Edit files in `wp-content/themes/` or `wp-content/plugins/`
5. **Apply changes**: Use `studio wp` to activate themes/plugins, flush caches
6. **Verify**: Visit the site URL or use `studio wp eval` to test

## Common Workflows

**Install and activate a plugin:**
```bash
studio wp plugin install woocommerce --activate
```

**Create a child theme:**
```bash
mkdir -p wp-content/themes/my-child-theme
# Create style.css with Template: twentytwentyfive header
# Create functions.php to enqueue parent styles
studio wp theme activate my-child-theme
```

**New themes:** WordPress's default themes are block themes, styled with `theme.json` and built from templates and patterns.

**Check if a plugin/theme change works:**
```bash
studio wp eval 'echo function_exists("my_function") ? "yes" : "no";'
```

**Query the database:**
```bash
studio wp db query "SELECT option_name, option_value FROM wp_options WHERE option_name = 'siteurl';"
```

**Restart the site after config changes:**
```bash
studio stop && studio start --skip-browser
```

## Debugging

**`studio` command not found:**

If the `studio` command is not available in the terminal (e.g., "command not found" or "not recognized" errors), the Studio CLI is not installed. The user must open the WordPress Studio desktop app, go to **Settings → Studio CLI for terminal**, and enable the toggle to install it. Once installed, the user should open a new terminal window for the `studio` command to become available.

**Enable WordPress debug logging:**
```bash
studio config set --debug-log --debug-display
```

**Check PHP errors (if debug logging is enabled):**
```bash
cat wp-content/debug.log
```

**Check if a plugin is active:**
```bash
studio wp plugin list --status=active --format=csv
```

**Verify PHP runtime works:**
```bash
studio wp eval 'echo "OK";'
```

## Studio MCP Server (AI agent tools)

Studio ships an MCP (Model Context Protocol) server so an AI assistant can drive Studio directly. It runs over stdio via `studio mcp` (requires the `studio` CLI installed). Add it under the `"mcpServers"` key:

```json
{
  "wordpress-studio": {
    "command": "studio",
    "args": [ "mcp" ]
  }
}
```

Run `studio mcp --help` for per-assistant install commands and config paths. Docs: https://developer.wordpress.com/docs/developer-tools/studio/mcp-on-studio/

The MCP server lists its tools, each with what it does.

## Managing This Site

Use the Studio CLI to manage this site. All `studio` commands accept a `--path <dir>` flag to target a specific site; when run from the site root, the path is detected automatically.

**Site lifecycle:**
```bash
studio start            # Start the WordPress server
studio stop             # Stop the WordPress server
studio status           # Show URL, admin credentials, PHP/WP versions
studio config set --php 8.4  # Change PHP version
studio config set --wp 6.8   # Update WordPress version
```

**Cloud preview sites** (requires `studio auth login`):
```bash
studio preview create   # Upload site to a temporary WordPress.com preview URL
studio preview list     # List existing preview sites
studio preview update   # Re-upload and refresh a preview site
studio preview delete   # Remove a preview site
```

**Publishing to WordPress.com or Pressable** (requires `studio auth login`):

Sync a local site to/from a connected remote site.

```bash
studio push    # Push this local site up to its connected WordPress.com/Pressable site
studio pull    # Pull the connected remote site down onto this local site
```

- Target a specific remote with `--remote-site <url-or-id>`. A site need not be
  pre-connected, but connecting it avoids re-entering the URL/ID each time.
- Limit what syncs with `--options <all|sqls|uploads|plugins|themes|contents>`
  (default: `all`).
- **`push` overwrites the remote site; `pull` overwrites this local site** (and
  stops/restarts it during the pull) — confirm the target before running either.
- Not every site is syncable. If a push/pull reports the remote needs an upgrade,
  a transfer, or admin access, resolve that first — it cannot sync until then.
- To publish to a host that runs MySQL instead, export a MySQL dump — see the
  Database section above.

**Authentication:**
```bash
studio auth login   # Authenticate with WordPress.com (opens browser)
studio auth status  # Check authentication status
studio auth logout  # Clear stored credentials
```

## WordPress Development Best Practices

**Themes and plugins:** Add custom themes to `wp-content/themes/` and plugins to `wp-content/plugins/`. To customise an existing theme, create a child theme rather than modifying the parent directly.

**Use hooks, not direct edits:** Extend WordPress via actions and filters in a plugin or theme, leaving the core files in `wp-includes/` and `wp-admin/` as shipped. Core edits are overwritten on every WordPress update.

```php
// Correct: extend via hooks
add_action( 'wp_enqueue_scripts', function () {
    wp_enqueue_style( 'my-theme', get_stylesheet_uri() );
} );
```

**Data handling:** Always sanitize input and escape output.
- Sanitize: `sanitize_text_field()`, `absint()`, `wp_kses_post()`
- Escape: `esc_html()`, `esc_attr()`, `esc_url()`, `wp_kses()`
- Database: use `$wpdb->prepare()` for all queries with dynamic values

**Options and metadata:** Use the WordPress Options API (`get_option` / `update_option`) and post/user/term meta APIs rather than direct database queries wherever possible.

**`wp-config.php`:** Studio strips the default MySQL `DB_*` constants (`DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`) from `wp-config.php`; the SQLite integration (see below) makes the database connection.

## When to Create vs. Modify

- **"Add a plugin/theme"**: Create files in `wp-content/plugins/` or `wp-content/themes/`
- **"Change the site"**: Modify existing theme/plugin files
- **"Install X"**: Use `studio wp plugin install X --activate`
- **"Debug/fix"**: Enable debug logging first: `studio config set --debug-log`

## Database: SQLite (not MySQL)

Studio uses **SQLite** as the WordPress database backend via the [SQLite Database Integration](https://github.com/WordPress/sqlite-database-integration) plugin. There is no MySQL server. The plugin works as a MySQL emulation layer — it translates WordPress's MySQL queries into SQLite, so standard `$wpdb` queries work without any changes.

**File locations:**
- Integration plugin: `wp-content/mu-plugins/sqlite-database-integration/`
- WordPress database drop-in: `wp-content/db.php`, which loads the integration
- SQLite database file: `wp-content/database/.ht.sqlite`

**Querying the database directly:**
```bash
studio wp db query "SELECT option_name, option_value FROM wp_options LIMIT 10;"
```

**Migrating to MySQL (production / live site):**

SQLite is only how Studio stores data locally — it does not lock you in. Studio
exports a **MySQL-compatible** database dump (standard `DROP TABLE` / `CREATE TABLE` /
`INSERT INTO`) that imports cleanly into any MySQL or MariaDB host. No migration
plugin is required, and the dump itself has no SQLite/MySQL compatibility issues.

```bash
studio export my-site.sql --mode db   # MySQL-compatible DB dump (preferred)
```

Then import it on the live host:
```bash
mysql -u <user> -p <database> < my-site.sql
```

For a full backup (files + database together), export a `.zip` instead:
```bash
studio export my-site.zip             # full site: wp-content + DB
```

The Studio MCP `site_export` tool (and Studio Code) can produce the same `.sql` dump
from a single prompt — see the Studio MCP Server section above.

**Known limitations:** (these apply to *running on* SQLite locally — not to the
exported MySQL dump above)
- No stored procedures or user-defined functions
- No `FULLTEXT` index support (use a search plugin instead)
- The `DB_NAME`, `DB_HOST`, `DB_USER` and `DB_PASSWORD` constants are not defined on this site; `$wpdb` works as usual
- Plugins that explicitly check for a MySQL connection and refuse to run may not be compatible

## Studio-Specific Notes

**Must-use plugins:** The `wp-content/mu-plugins/` directory contains the SQLite integration, which the database runs on.

**Port and URL:** Studio assigns the local URL and port, which can change; `studio status` shows the current URL.

**Multisite:** WordPress Multisite is supported in Studio sites when the site was created from a blueprint that includes the `enableMultisite` step. Multisite requires a custom domain: Studio will prompt for one during site creation when the blueprint includes that step.

**Persistence:** The site runs on a native PHP server, so all file writes persist to disk normally and standard WP-Cron behavior applies.

**Skill triage scripts:** Some skills reference a `wp-project-triage` detection script that is not bundled with Studio. You can skip that step — Studio sites are always valid WordPress projects.
