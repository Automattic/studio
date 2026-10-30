# Studio screenshots

Captured from Studio 2.1.0-beta1 by `npm run screenshots`, signed out except the signed-in suites (`signedIn` in their JSON), which show a WordPress.com account with its email masked.
Upload to WordPress.com; a file named `<name>.webp` becomes `https://developer.wordpress.com/wp-content/uploads/YYYY/MM/<name>.webp`.
Shots with annotations also have a `<name>-annotated.webp`.

| File | Suite | Shows | Used on | Replaces |
| --- | --- | --- | --- | --- |
| `welcome.webp` | first-run | First-run Welcome to WordPress Studio dialog | `index.md` | `2024/04/welcome.png` |
| `add-site.webp` | first-run | Add site dialog: Create / Connect / Import, Blueprint categories, Choose a starting point | `sites.md`<br>`blueprints/index.md` | `2025/01/add-a-site.png` |
| `blueprints-library.webp` | first-run | Add site → Blueprints → Business category | `blueprints/index.md` | `2025/10/blueprints-library.png` |
| `blueprint-details.webp` | first-run | A Blueprint’s details, with Preview in browser and Create site | `blueprints/index.md` | `2025/10/create-site-from-blueprint.png` |
| `add-site-connect.webp` | first-run | Add site → Connect, signed out: Connect to an existing WordPress | `sync.md` | — |
| `add-site-import.webp` | first-run | Add site → Import: Drop a WordPress backup here / Choose file | `import-export.md` | `2025/01/add-a-site-1.png` |
| `add-site-upload.webp` | first-run | Add site → Upload: Upload a Blueprint, with its drop area and Choose file | `blueprints/index.md` | — |
| `create-site.webp` | first-run | Create a blank site: Site name, Local path, and the WordPress and PHP versions | `sites.md` | — |
| `create-site-advanced.webp` | first-run | Create a blank site → Advanced settings (File access, Use custom domain, admin credentials) | `sites.md`<br>`php-runtimes.md` | `2025/01/create-site-advanced.png` |
| `create-site-https.webp` | first-run | Create your site → Advanced settings with Use custom domain and Enable HTTPS | `ssl-in-studio.md` | `2025/03/create-site-https.png` |
| `orientation-guide.webp` | first-run | Orientation guide, page 1, shown after the first site is created | `index.md` | — |
| `main-window-signed-out.webp` | workspace | Main window, signed out: sidebar, Studio Code chat, and the site preview | `index.md`<br>`studio-code/index.md` | `2024/04/main-window-signed-out.png` |
| `command-palette.webp` | workspace | Command palette (⌘K) | `index.md` | — |
| `preview-destinations.webp` | workspace | Site preview address bar shortcuts: Front end / WordPress Admin / Database | `sites.md`<br>`debugging/index.md`<br>`frequently-asked-questions.md` | `2026/04/preview-destinations.png` |
| `responsive-mode-presets.webp` | workspace | Responsive mode: the device menu open, with Responsive and the device sizes | `sites.md` | — |
| `responsive-mode.webp` | workspace | Responsive mode at a phone size (iPhone 17), with the responsive toolbar above the preview | `sites.md` | — |
| `site-status-button.webp` | workspace | Sidebar site row with its Stop button and tooltip | `sites.md` | `2025/01/site-status-tooltip.png` |
| `site-stopped.webp` | workspace | A stopped site: Start button in the sidebar and the saved preview image | `sites.md` | `2025/01/site-stopped.png` |
| `site-menu.webp` | site-menu | The site menu, opened from the site icon at the top of the chat | `sites.md` | `2025/01/sidebar-site-menu.png` |
| `site-menu-open-in.webp` | site-menu | Site menu → Open in (browser, file manager, editor, terminal, phpMyAdmin) | `sites.md`<br>`frequently-asked-questions.md` | — |
| `site-menu-export.webp` | site-menu | Site menu → Export (Export site / Export database) | `import-export.md` | `2025/01/site-overview-1.png` |
| `delete-site-dialog.webp` | site-menu | Delete site confirmation, with Also move files and database to Trash | `sites.md` | `2025/01/delete-site-dialog.png` |
| `import-overwrite-dialog.webp` | site-menu | Import a backup into an existing site: the overwrite confirmation | `import-export.md` | `2025/01/import-overwrite-dialog.png` |
| `site-settings.webp` | site-settings | Settings dialog, Site scope → Settings (site name, WordPress version, local domain, credentials) | `sites.md` | `2025/01/site-settings.png` |
| `site-settings-domain.webp` | site-settings | Site settings → Local domain with Use custom domain and Enable HTTPS (not saved) | `ssl-in-studio.md` | — |
| `site-settings-debug.webp` | site-settings | Site settings → Debug with Xdebug turned on (not saved) | `xdebug.md`<br>`debugging/index.md` | `2026/01/site-debugging.png` |
| `site-settings-php.webp` | site-settings | Site settings → PHP (PHP version, File access) | `php-runtimes.md`<br>`sites.md` | `2025/01/site-settings-php.png` |
| `settings-general.webp` | studio-settings | Settings dialog, Studio scope → General (language, code editor, terminal, …) | `sites.md` | `2025/01/app-settings.png` |
| `settings-studio-cli.webp` | studio-settings | Settings → General → Studio CLI for terminal | `cli.md` | `2025/05/app-settings-account.png` |
| `settings-ai-providers.webp` | studio-settings | Settings → AI Providers (WordPress.com and Anthropic) | `studio-code/index.md` | `2026/04/app-settings-ai.png` |
| `settings-skills.webp` | studio-settings | Settings → Skills | `agent-skills-wordpress-studio.md` | `2026/04/app-settings-skills.png` |
| `settings-mcp.webp` | studio-settings | Settings → MCP (install instructions and MCP configuration) | `mcp-on-studio.md` | `2026/04/app-settings-mcp.png` |
| `settings-keyboard.webp` | studio-settings | Settings → Keyboard (shortcuts) | `index.md` | — |
| `main-window-signed-in.webp` | signed-in | Main window, signed in: the account menu button at the bottom of the sidebar | `index.md` | — |
| `account-menu.webp` | signed-in | Account menu: name, email, Settings, Appearance, AI Providers, Usage, Log out | `index.md` | — |
| `composer-add-menu.webp` | signed-in | Chat box + menu, signed in: Add files, the commands, and Skills | `studio-code/index.md` | — |
| `annotate-toolbar.webp` | signed-in | Annotate: the Annotations toolbar over the site preview, with Cancel and Send | `studio-code/index.md` | — |
| `annotate-note.webp` | signed-in | Annotate: two saved notes on the page, and a third open on the hero photo, being typed | `studio-code/index.md` | — |
| `annotate-staged.webp` | signed-in | Annotate: two saved notes marked on the page and waiting in the chat box as "2 annotations", with Send in the Annotations toolbar | `studio-code/index.md` | — |
| `share-create-preview.webp` | signed-in | Share and publish → Share, with Create preview | `preview-sites.md` | `2025/01/studio-site-new-preview-1.png` |
| `publish-panel.webp` | signed-in | Share and publish → Publish: Existing site… and New site… | `sync.md` | — |
| `publish-choose-site.webp` | signed-in | Publish → Choose an existing site, listing the account’s WordPress.com and Pressable sites | `sync.md` | `2025/01/studio-connect-live-site.png` |
| `model-menu.webp` | signed-in | Chat box model menu: Fast, Balanced and Strong, with the AI credits remaining | `studio-code/index.md`<br>`studio-code/choosing-an-ai-model-tier-in-studio-code.md` | — |
| `add-ai-credits.webp` | signed-in | Add AI credits: the four one-time credit amounts | `studio-code/ai-credits-guidelines.md` | — |
| `settings-account.webp` | signed-in | Settings → General, signed in: the account row with Log out | `index.md` | — |
| `settings-usage.webp` | signed-in | Settings → Usage: AI credits remaining, Add credits, and Preview sites | `preview-sites.md`<br>`studio-code/index.md`<br>`studio-code/ai-credits-guidelines.md` | — |
| `settings-sharing.webp` | signed-in | Settings → Sharing, signed in | `preview-sites.md` | `2025/01/studio-delete-all-preview-sites.png` |
| `settings-ai-providers-signed-in.webp` | signed-in | Settings → AI Providers, signed in: WordPress.com connected | `studio-code/index.md` | — |
| `add-site-connect-signed-in.webp` | signed-in | Add site → Connect, signed in, listing the account’s WordPress.com and Pressable sites | `sync.md` | — |
| `share-previews.webp` | signed-in-previews | Share tab with previews: the previews list with expiry dates and Create another preview | `preview-sites.md` | `2025/01/studio-new-site-preview-link.png` |
| `share-preview-actions.webp` | signed-in-previews | Share tab → a preview’s Preview actions menu (Update, Copy link, Visit preview, Rename, Delete preview) | `preview-sites.md` | `2025/01/studio-preview-more-actions.png` |
| `publish-switcher.webp` | signed-in-connected | Publish details → the website switcher, listing two connected websites and Connect another site… | `sync.md` | — |
| `pull-choose-files.webp` | signed-in-connected | Publish details → Pull changes → What to pull, with Choose files… and a few items selected | `sync.md` | `2025/01/studio-pull-selective.png` |
| `publish-choose-files.webp` | signed-in-connected | Publish details → Publish changes → What to publish, with Choose files… and a few items selected | `sync.md` | `2025/01/studio-selective-push.png` |

## Capture manually

These need a WordPress.com login, a connected live site, or Studio Code output.

| Shows | Used on | Replaces |
| --- | --- | --- |
| WordPress.com authorization screen with Approve, opened by Log in | `index.md` | — |
| Browser prompt to open the Studio app after approving the login | `index.md` | — |
| Studio Code chat for a selected site, with a reply in the transcript | `studio-code/index.md` | `2026/04/studio-code.png` |
