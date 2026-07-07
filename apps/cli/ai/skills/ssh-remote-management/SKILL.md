---
name: ssh-remote-management
description: Manage a remote WordPress site over SSH with wp_cli and the remote file tools, including safe production workflow, database backups, WP-CLI recipes, large content delivery, and visual verification.
user-invokable: true
---

# SSH Remote Management

Use this skill before making changes to a WordPress site connected over SSH.

## Ground rules

The site is on a remote server and is very likely **live production**. Every change is immediately visible to visitors.

- Prefer the smallest change that fulfills the request.
- Confirm destructive or risky operations with the user before proceeding: deleting content, deactivating or deleting plugins, switching themes, editing the active theme's code, and any `wp db` operation that writes.
- Back up the database before schema-changing or content-destructive work: `db export studio-backup.sql` (the file lands in the WordPress root; tell the user where it is, and remove it with the file tools when it is no longer needed — never leave database dumps in a web-accessible directory longer than necessary).
- Do NOT modify WordPress core files. Only work within `wp-content/`.

## Tool shape

- `wp_cli` runs WP-CLI on the remote server in the site's WordPress root. Arguments are literal — no shell substitution, pipes, or redirection.
- `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Ls` operate on remote files. Paths are relative to the WordPress root and cannot escape it.
- Capabilities depend on the SSH user's file permissions and the WP-CLI setup on the server. A permission error means the SSH user cannot write that path, not that the operation is impossible in WordPress.

## Understanding the site

Start with lightweight reads:

- `option get home`, `option get blogname`, `core version`
- `theme list --status=active`, `plugin list`
- `post list --post_type=page --fields=ID,post_title,post_status`
- `Ls` on `wp-content/themes` and `Grep` for relevant code

Use `--format=json` and `--fields=...` on list commands to keep responses small. Fetch individual items by ID when full content is needed.

## Making changes

- **Content**: `post create` / `post update` / `post delete` (moves to trash by default), `term`, `menu`, `option update`.
- **Plugins**: `plugin install <slug> --activate`, `plugin deactivate <slug>`, `plugin update <slug>`.
- **Themes**: `theme install`, `theme activate`; edit theme files with `Write`/`Edit` under `wp-content/themes/`.
- **Database**: `db export <file>` for backups; `search-replace <old> <new> --all-tables --dry-run` first, then without `--dry-run` once the user confirms.
- **Cache**: after significant changes run `cache flush`; if a caching plugin is active, flush it too (e.g. `w3-total-cache flush all`, `wp super-cache flush`) so visitors see the change.

## Large content

Do not pass large generated content (full page markup, long CSS) inline in `wp_cli` arguments — it can exceed command-length limits.

1. `Write` the content to a scratch file inside the WordPress root, e.g. `wp-content/studio-tmp/page-home.html`.
2. Reference the file from WP-CLI: `post create wp-content/studio-tmp/page-home.html --post_type=page --post_title=Home --post_status=draft`.
3. Delete the scratch file with `wp_cli` (`eval 'unlink("wp-content/studio-tmp/page-home.html");'`) or leave `wp-content/studio-tmp/` tidy by overwriting it next time — never leave scratch files in themes or uploads.

Create drafts first (`--post_status=draft`) and only publish after the user confirms, unless the user explicitly asked to publish.

## Verifying

1. Check command output — WP-CLI prints `Success:` / `Error:` lines.
2. Verify visually with `take_screenshot` using `viewport: "all"` for desktop and mobile.
3. If something looks wrong, inspect with `Read`/`Grep` and fix — do not retry the same failing command blindly.

## Failure modes

- **SSH connection errors** (`Could not connect …`): the server is unreachable or key-based auth failed. Ask the user to verify `ssh <destination>` works non-interactively in their terminal.
- **WP-CLI not found**: WP-CLI is not installed on the server or not on PATH. The site connection can specify a custom executable path.
- **Permission denied on file writes**: the SSH user lacks write access to that path. Report which path failed and let the user adjust permissions.
- **PHP fatal after editing theme/plugin code**: immediately revert the edit with `Edit` (you have the previous content from your `Read`), verify with a screenshot, then diagnose.
