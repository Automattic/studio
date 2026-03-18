## IMPORTANT: WP-CLI in WordPress Studio

When following any WordPress skill or documentation that references `wp` commands, you MUST prefix them with `studio`:

- Skill says: `wp plugin install woocommerce` → Run: `studio wp plugin install woocommerce`
- Skill says: `wp db export` → Run: `studio wp db export`
- Skill says: `wp search-replace` → Run: `studio wp search-replace`

This applies to ALL `wp` commands. Studio runs WordPress through PHP WASM, and a standalone `wp` binary will NOT work. `wp shell` is NOT supported — use `studio wp eval` instead.

## Workflow

1. **Check site status**: `studio site status` — get URL, credentials, PHP/WP versions
2. **Ensure site is running**: `studio site start --skip-browser` if needed
3. **Make changes**: Edit files in `wp-content/themes/` or `wp-content/plugins/`
4. **Apply changes**: Use `studio wp` to activate themes/plugins, flush caches
5. **Verify**: Visit the site URL or use `studio wp eval` to test

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

**When building themes, always build block themes** (not classic themes). Use `theme.json` for styling, templates, and patterns.

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
studio site stop && studio site start --skip-browser
```

## Debugging

**Enable WordPress debug logging:**
```bash
studio site set --debug-log --debug-display
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

## Constraints

| Don't | Do instead |
|-------|-----------|
| Edit `wp-includes/` or `wp-admin/` | Use actions/filters in a plugin or child theme |
| Use bare `wp` CLI | Use `studio wp` |
| Use `wp shell` | Use `studio wp eval` |
| Reference `DB_HOST`, `DB_NAME`, etc. | Use `$wpdb` directly (SQLite handles it) |
| Delete `wp-content/db.php` | It's the SQLite drop-in — leave it |
| Delete `wp-content/mu-plugins/sqlite-*` | Required for database to work |
| Hardcode port numbers | Use `studio site status` to get the current URL |
| Use `FULLTEXT` indexes | Use a search plugin or simple `LIKE` queries |
| Build classic themes | Build block themes with `theme.json` |

## Managing This Site

Use the Studio CLI to manage this site. All `studio` commands accept a `--path <dir>` flag to target a specific site; when run from the site root, the path is detected automatically.

**Site lifecycle:**
```bash
studio site start          # Start the WordPress server
studio site stop           # Stop the WordPress server
studio site status         # Show URL, admin credentials, PHP/WP versions
studio site set --php 8.3  # Change PHP version
studio site set --wp 6.8   # Update WordPress version
```

**Cloud preview sites** (requires `studio auth login`):
```bash
studio preview create   # Upload site to a temporary WordPress.com preview URL
studio preview list     # List existing preview sites
studio preview update   # Re-upload and refresh a preview site
studio preview delete   # Remove a preview site
```

**Authentication:**
```bash
studio auth login   # Authenticate with WordPress.com (opens browser)
studio auth status  # Check authentication status
studio auth logout  # Clear stored credentials
```

## WordPress Development Best Practices

**Themes and plugins:** Add custom themes to `wp-content/themes/` and plugins to `wp-content/plugins/`. To customise an existing theme, create a child theme rather than modifying the parent directly.

**Use hooks, not direct edits:** Extend WordPress via actions and filters. NEVER edit core files — Studio runs on WordPress Playground and core changes will NOT persist across server restarts.

```php
// Correct: extend via hooks
add_action( 'wp_enqueue_scripts', function () {
    wp_enqueue_style( 'my-theme', get_stylesheet_uri() );
} );

// Incorrect: do not edit wp-includes/ or wp-admin/ directly
```

**Data handling:** Always sanitize input and escape output.
- Sanitize: `sanitize_text_field()`, `absint()`, `wp_kses_post()`
- Escape: `esc_html()`, `esc_attr()`, `esc_url()`, `wp_kses()`
- Database: use `$wpdb->prepare()` for all queries with dynamic values

**Options and metadata:** Use the WordPress Options API (`get_option` / `update_option`) and post/user/term meta APIs rather than direct database queries wherever possible.

**`wp-config.php`:** Studio strips the default MySQL `DB_*` constants (`DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`) from `wp-config.php` — do not add them back. The database connection is handled by the SQLite integration (see below).

## When to Create vs. Modify

- **"Add a plugin/theme"**: Create files in `wp-content/plugins/` or `wp-content/themes/`
- **"Change the site"**: Modify existing theme/plugin files, NEVER core files
- **"Install X"**: Use `studio wp plugin install X --activate`
- **"Debug/fix"**: Enable debug logging first: `studio site set --debug-log`

## Database: SQLite (not MySQL)

Studio uses **SQLite** as the WordPress database backend via the [SQLite Database Integration](https://github.com/WordPress/sqlite-database-integration) plugin. There is no MySQL server. The plugin works as a MySQL emulation layer — it translates WordPress's MySQL queries into SQLite, so standard `$wpdb` queries work without any changes.

**File locations:**
- Integration plugin: `wp-content/mu-plugins/sqlite-database-integration/`
- WordPress database drop-in: `wp-content/db.php` ← do NOT modify or delete
- SQLite database file: `wp-content/database/.ht.sqlite`

**Querying the database directly:**
```bash
studio wp db query "SELECT option_name, option_value FROM wp_options LIMIT 10;"
```

**Known limitations:**
- No stored procedures or user-defined functions
- No `FULLTEXT` index support (use a search plugin instead)
- Do NOT reference `DB_NAME`, `DB_HOST`, `DB_USER`, or `DB_PASSWORD` constants — they are not defined on this site
- Plugins that explicitly check for a MySQL connection and refuse to run may not be compatible

## Studio-Specific Notes

**WordPress core:** Do NOT modify files inside `wp-includes/` or `wp-admin/`. Studio sites run on WordPress Playground (PHP WASM), and core changes will NOT persist as expected.

**Must-use plugins:** The `wp-content/mu-plugins/` directory contains the SQLite integration. Do NOT remove files from this directory.

**Port and URL:** The local URL and port are assigned dynamically by Studio. Always retrieve the current URL with `studio site status` rather than hardcoding it.

**Multisite:** WordPress Multisite is supported in Studio sites when the site was created from a blueprint that includes the `enableMultisite` step. Multisite requires a custom domain: Studio will prompt for one during site creation when the blueprint includes that step.

**Persistence:** The site runs in-process using PHP WASM. File writes to `wp-content/` persist to disk normally. Server-side cron is emulated; long-running background processes are not supported.

## Available Skills

This site includes WordPress development skills that provide detailed guidance:

- **studio-cli** — Studio CLI commands for site management, auth, and previews
- **wp-plugin-development** — Plugin architecture, hooks, Settings API, security
- **wp-block-development** — Gutenberg blocks, block.json, attributes, deprecations
- **wp-block-themes** — Block themes, theme.json, templates, patterns, style variations
- **wp-rest-api** — REST API endpoints, controllers, schema, authentication
- **wp-wpcli-and-ops** — WP-CLI operations, search-replace, cron, automation

These skills are in `.claude/skills/` (or `.agents/skills/`). Reference them for detailed procedures on specific WordPress development tasks.

> **Note:** Remote skills reference `wp` commands directly. In Studio, always prefix with `studio` (e.g., `studio wp plugin list`).

> **Note:** Some skills reference a `wp-project-triage` detection script that is not bundled with Studio. You can skip that step — Studio sites are always valid WordPress projects.
