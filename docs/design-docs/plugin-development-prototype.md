# Plugin Development in Studio — Prototype Notes

Research and working notes for the plugin-development exploration on the
`explore-site-centric-conversation-chrome` branch. This documents what we've
learned from the reference implementations and what the prototype currently
does, so future sessions can pick up where we left off.

## Reference: PR #3970 ("Add plugin development workbench")

https://github.com/Automattic/studio/pull/3970 — authored by GitHub user `f`
(Fatih Kadir Akın), June 2026. Adds plugin development to the **legacy
renderer** (`apps/studio`), not the agentic UI. Key pieces:

- **Add a plugin project**: folder picker → scans the folder (up to 4 levels
  deep, skipping `node_modules`, `vendor`, `tests`, `build`, `dist`, `.git`,
  `.svn`, `.wordpress-org`) for a file with a WordPress plugin header, parses
  the headers (Plugin Name, Description, Version, Author, Text Domain,
  Requires at least, Tested up to, Requires PHP), and infers the slug from
  the text domain or folder name. See `tools/common/lib/plugin-projects.ts`
  on the `plugin-development` branch.
- **WordPress.org connection**: WordPress.org has no OAuth — the PR logs in
  via an embedded Electron window on `login.wordpress.org` and captures only
  the session cookies (`apps/studio/src/modules/user-settings/lib/wordpress-org-auth.ts`).
  With a session it lists plugins the account is a **committer or
  contributor** on, and "Work on this" creates a local **SVN checkout** of
  `plugins.svn.wordpress.org/<slug>`.
- **Project workbench**: Monaco-based editor, file explorer, readme syntax
  highlighting, Playground preview, release/version management, AI chat.
- Publishing metadata and version-bump machinery live in
  `tools/common/lib/publishing-config.ts` and `tools/common/types/publishing.ts`.

## Reference: Pressship (https://pressship.org)

**PR #3970 is Pressship absorbed into Studio, by the same author.** Evidence:
the PR migrates legacy `.pressshipignore` files to a Studio ignore format,
its readme highlighting recognizes `pressship` commands, and its test
fixtures are named "Pressship Example". The PR reimplements the pipeline
natively rather than shelling out to the CLI.

Pressship itself is a Node.js CLI (npm: `pressship`, MIT, Automattic org,
first published May 2026) that automates the WordPress.org plugin publishing
lifecycle — "`npm publish` for WordPress.org". How it works:

- **No API exists for WordPress.org publishing**, so Pressship automates the
  human interfaces: Playwright Chromium drives the real login page (session
  cookies only, never the password), the developer upload form (attaches the
  zip to `input[type="file"]` and submits), and scrapes the logged-in
  developer dashboard for review status.
- **Releases** use real `svn` against `plugins.svn.wordpress.org` (checkout,
  trunk sync, tag, commit). Offers to install Subversion via the OS package
  manager if missing. SVN layout: editable code in `trunk/`, published
  versions in `tags/<version>/`.
- **Validation**: official WordPress.org readme validator + Plugin Check,
  run in a self-managed WordPress + SQLite environment when WP-CLI isn't
  present.
- **Smart `publish` routing**: never-seen plugin → submit for review;
  pending review → reupload; approved with SVN → release. Dry-run-first,
  explicit confirmation before mutations.
- **Command suite**: `login`, `whoami`, `logout`, `info`, `ls`, `get`,
  `status`, `studio` (local VS Code-style web workspace), `version
  <patch|minor|major>` (bumps header + readme stable tag together),
  `verify`, `pack`, `publish`, `submit`, `release`, `demo` (WordPress
  Playground boot).
- **Agent layer**: ships a `wordpress-plugin-publish` Claude/Codex skill and
  publishes `/ai` + `/ai.txt` endpoints. Prescribed agent workflow: whoami →
  verify → pack → dry-run → explicit user approval → publish.
- `pressship ls` reads WordPress.org's plugin author archive; for the
  logged-in account it also includes plugins with SVN committer access.

Useful when wiring flows for real: verify → pack → dry-run → publish is the
sequence a Studio release UI would need to expose. Open question for later:
depend on the pressship package, port it (as #3970 does), or share a library.

## Research: anatomy of a WordPress plugin

From the Plugin Handbook (developer.wordpress.org/plugins):

- **Minimum viable plugin = one PHP file with a header comment**, and the
  only required header field is `Plugin Name`.
- Full header field set: Plugin Name (required), Plugin URI, Description
  (shown in Plugins screen; keep under 140 chars), Version, Requires at
  least, Requires PHP, Author, Author URI, License, License URI, Text
  Domain, Domain Path, Network, Update URI, Requires Plugins (dependency
  slugs, WP 6.5+).
- Conventional structure: `plugin-name/plugin-name.php` (header + `ABSPATH`
  guard), optional `uninstall.php` at root, then `/includes`, `/admin`,
  `/public`, `/languages`.
- `readme.txt` is **publishing** metadata (WordPress.org directory only):
  Contributors, Tags, Tested up to, Stable tag, sections. Not needed at
  creation time.
- Form-design consequence: almost nothing needs to be asked at creation.
  Text Domain should always equal the slug (derived from the name);
  Requires at least / Requires PHP should be scaffold defaults; readme
  fields belong to a future publish flow.

## Current prototype state (`apps/ui`, agentic UI)

**Core model: plugins are just sites with extra presentation.** Completing
any plugin flow creates a **real local site** (same `useCreateSite`
mutation as Add a site — so status, chat, and preview all work), then tags
the site as a plugin in `apps/ui/src/lib/plugin-prototype.ts`
(localStorage-backed). The tag only changes how the sidebar renders the
row.

**The Create a new plugin flow is real**: after creating the site, the
form calls `connector.scaffoldPlugin( siteId, meta )` → `scaffoldPlugin`
IPC handler (`apps/studio/src/ipc-handlers.ts`) → the scaffold library at
`apps/studio/src/lib/scaffold-plugin.ts`, which writes a structured plugin
(`<slug>.php` with the full header, `readme.txt`, `uninstall.php`,
`includes/`) into `wp-content/plugins/<slug>/` and activates it via
`wp plugin activate` (works running or stopped). Scaffold failure leaves
the site untagged and surfaces an error in the form. Still simulated: the
existing-folder flow copies nothing, no SVN checkout happens, and the .org
"connected account" is a stand-in.

- **Entry**: sidebar + menu → "Add a plugin" → `/onboarding/plugin`
  (`apps/ui/src/ui-classic/router/route-onboarding-plugin/`). Three cards
  mirroring the Add a site picker (styles reused from
  `route-onboarding-home/style.module.css`; illustrations still borrowed
  from the site cards — needs plugin-specific art):
  1. **Create a new plugin** → `/onboarding/plugin/create`
  2. **Connect to WordPress.org** → `/onboarding/plugin/connect` (disabled
     offline)
  3. **Add an existing plugin** → opens the OS folder picker via
     `connector.selectSiteFolder()` (dialog title still says "site" —
     hardcoded in the connector), then lands on the create form with
     `{ path, name }` passed through search params.
- **Create form** (`route-onboarding-plugin-create/`): DataForm, same
  frosted-panel + Advanced-collapse treatment as the create-site form.
  Basics: Plugin name (required), Description, Author. Collapsed "Plugin
  details": Version (default `0.1.0`), Plugin URI, Author URI, License
  (default "GPLv2 or later"). Live "Plugin slug and text domain" preview.
  In existing-folder mode the title changes and the folder path shows
  read-only. Submit creates the site, tags it, and opens the site's new
  session view (chat + preview).
- **WordPress.org auth is real** (v1): WordPress.org has no OAuth, so login
  opens an isolated in-app `BrowserWindow` on `login.wordpress.org` using a
  dedicated persistent session partition (`persist:studio-wordpress-org` —
  its own cookie jar, none of the user's browser state; the same isolation
  pressship gets from a separate Chromium, without bundling one). Success is
  detected by polling for the `*logged_in*` cookie and verified against a
  login-required page; a cookie snapshot is mirrored to
  `~/.studio/wordpress-org-storage.json` (0600, lockfile-guarded).
  Implementation:
  `apps/studio/src/modules/user-settings/lib/wordpress-org-auth.ts` +
  `getWordPressOrgAccount`/`loginToWordPressOrg`/`logoutFromWordPressOrg`
  IPC → connector → `apps/ui/src/data/queries/use-wporg-account.ts`. Login
  UI lives on the connect screen (signed-out block) and in Settings
  ("WordPress.org account" section). Not yet used for authenticated
  scraping (committer-only plugin lists), submissions, or SVN credentials.
- **Connect screen** (`route-onboarding-plugin-connect/`): shows the
  connected account's real plugins (public author-archive query by the
  authenticated username) and lists **real** directory data via
  `apps/ui/src/data/queries/use-wporg-plugins.ts`, which queries
  `api.wordpress.org/plugins/info/1.2/` (`action=query_plugins`,
  `request[author]=…`, icons + active_installs fields). List is sorted by
  active installs and capped at 9 (`SIMULATED_PLUGIN_COUNT`) so it reads
  like a real account (6–12 plugins), not a directory dump. Selecting one
  and "Add plugin" creates + tags a site named after the plugin (keeps the
  directory icon for the sidebar row).
- **Sidebar** (`components/site-list/`): settled on the **grouped**
  presentation (the "mixed list" variant and the floating tweak panel were
  explored and removed). Plugin-tagged sites are split out of the
  draggable site list and render as ordinary `SiteSection` rows with a
  plugin glyph (or the wporg directory icon) under a "Plugins" accordion
  heading; sites get a matching "Sites" heading. The headings only appear
  once at least one plugin exists — plugin-less sidebars keep the plain
  flat site list. Selection is the normal route-driven site selection — a
  new plugin lands on `/sites/$siteId/new`, so its row is selected on
  arrival.
- Routes registered in `apps/ui/src/ui-classic/router/router.tsx`; wide
  layout widths for `/onboarding/plugin` and `/onboarding/plugin/connect`
  in `layout-onboarding/index.tsx`.

### Known gaps / next steps

- Decide the sidebar direction (mixed vs grouped), then how chat + preview
  should differ for plugin sites.
- No plugin files are scaffolded into the created site yet, and the
  existing-folder flow doesn't copy/link the picked folder.
- Plugin-specific card illustrations needed.
- Folder-picker dialog title, and real plugin-header scanning for the
  existing-folder flow (port `plugin-projects.ts` from the PR branch).
- Real .org connection would need the cookie-session approach in the main
  process (see `wordpress-org-auth.ts` on the PR branch).
