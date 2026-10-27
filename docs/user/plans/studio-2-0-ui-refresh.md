# Studio 2.0 UI refresh: docs update notes

The Markdown in `docs/` was updated against `trunk` at `a339eea3a` to describe the redesigned app (the `apps/ui` rebuild). These notes track what is still needed before the pages go to developer.wordpress.com.

## How the changes were checked

- UI labels come from the `apps/ui` source (`__()` strings, menus, settings sections).
- The signed-out flows were checked in `studio ui` against a throwaway profile (`DEV_CONFIG_DIR`): Add site (Create, Connect, Import, Blueprints), the site menu, the Settings dialog, the address bar shortcuts, the composer **+** menu, the command palette, and the orientation guide.
- **Not seen running, documented from code only:** everything that needs a WordPress.com login (the Publish panel, Share panel, Settings → Usage and Sharing when signed in, the model picker, connected AI providers), and desktop-only UI (the welcome dialog, Settings → General → Studio CLI, the Open in editor/terminal entries). Check these in the Desktop app before publishing.

## Terminology changes applied

| Old | New |
| --- | --- |
| App settings (tabs) | Settings dialog, **Studio** scope (pages) |
| Site overview → Overview / Settings / Debugging tabs | Site menu, and Settings dialog **Site** scope: Settings, Debug, PHP, Skills, Instructions |
| Site menu → Live sites, Push to live / Pull from live | **Publish** button above the preview; Website actions → Pull changes… |
| Site menu → Previews, New preview | **Share** button above the preview; Create preview, Update preview |
| Save settings | Save / Discard at the top of the dialog, shown once something changes |
| Chat history, Archived chats | Chats listed under each site in the sidebar, plus Pinned and Recent; Archive with Undo |
| ⌘N new chat | ⌘N adds a site; New chat is on the site row and in the command palette |
| App settings → AI (API key, Instructions) | Settings → AI Providers; Settings → Instructions → Custom instructions |

## Screenshots to recapture

Every image on the updated pages shows the old UI. The old `site-overview.png` image (sites.md) was dropped with its section, and `site-overview-1.png` (import-export.md) is still referenced but no longer matches anything.

- `index.md`: `2024/04/welcome.png`, `2024/04/main-window-signed-out.png`
- `sites.md`: `add-a-site.png`, `create-site-advanced.png`, `site-status-tooltip.png`, `site-stopped.png`, `sidebar-site-menu.png`, `app-settings.png`, `site-settings.png`, `site-settings-php.png`, `delete-site-dialog.png` (all `2025/01/`)
- `preview-sites.md`: `studio-site-new-preview-1.png`, `studio-new-site-preview-link.png`, `studio-preview-more-actions.png`, `studio-delete-all-preview-sites.png` (now captioned as Settings → Sharing)
- `sync.md`: `studio-connect-live-site.png`, `studio-pull-selective.png`, `studio-selective-push.png`
- `import-export.md`: `add-a-site-1.png`, `import-overwrite-dialog.png`, `site-overview-1.png`
- `studio-code/index.md`: `2026/04/studio-code.png`, `2026/04/app-settings-ai.png`
- `debugging/index.md`, `xdebug.md`: `2026/01/site-debugging.png`, `2026/04/preview-destinations.png`
- `php-runtimes.md`: `site-settings-php.png`
- `ssl-in-studio.md`: `2025/03/create-site-https.png`
- `cli.md`: `2025/05/app-settings-account.png`
- `mcp-on-studio.md`: `2026/04/app-settings-mcp.png`
- `agent-skills-wordpress-studio.md`: `2026/04/app-settings-skills.png`
- `blueprints/index.md`: `add-a-site.png`, `2025/10/blueprints-library.png`, `2025/10/create-site-from-blueprint.png`

`npm run screenshots` now captures the signed-out shots from Studio 2.0 (see the README), and its `index.md` lists which upload each one replaces. Its shots were dry-run against `studio ui`, except `settings-studio-cli`, which only exists in the Desktop app. When you run it on the Mac, check:

- `site-stopped`: in the browser build the stopped preview was blank; the Desktop app should show the saved preview image.
- `settings-studio-cli`: the only shot not exercised before.

After uploading, swap the image URLs in the pages above for the new uploads.

## Open questions

1. **Featured Blueprints.** `blueprints/index.md` still lists three featured Blueprints (Theme & plugin development, WordPress.com, WooCommerce). The 2.0 gallery shows none of them by name; it lists a "Development" Blueprint, "Commerce", "Quick Start" and others, from the remote Blueprints API. Confirm what is featured now and rewrite that section.
2. **Page name for Sync.** The UI no longer says "Sync": it's **Publish** (push) and **Pull changes**. The page keeps its "Studio Sync" title and URL for now; renaming it is an editorial call.
3. **Changelog.** `changelog.md` was not touched; add the 2.0 release notes when the release ships.
4. **Studio Code slash commands.** In the app, `/` also matches app commands such as choosing a model or working on the live site. The table only lists the agent's commands; decide whether to add these.
