# Docs refresh brief: trunk

## Changes to review (merged since de26adc78)

- Providers: Move WordPress.com push and pull behind a sites capability (#5897)
- Studio capture harness: screenshots and recordings of Studio that any agent can make, locally or in the cloud (#5641)

## Screenshot check (Studio 2.2.0)

### Failed: the script no longer reaches the screen

- `annotate-staged` (signed-in): locator.click: Timeout 30000ms exceeded.

### Changed: the app no longer looks like the committed image

- `docs/user/screenshots/images/welcome.webp` (first-run): 6589 pixels differ, differences in `docs-refresh-output/diffs/welcome.png`
- `docs/user/screenshots/images/add-site.webp` (first-run): 2753 pixels differ, differences in `docs-refresh-output/diffs/add-site.png`
- `docs/user/screenshots/images/blueprints-library.webp` (first-run): 2728 pixels differ, differences in `docs-refresh-output/diffs/blueprints-library.png`
- `docs/user/screenshots/images/blueprint-details.webp` (first-run): 3104 pixels differ, differences in `docs-refresh-output/diffs/blueprint-details.png`
- `docs/user/screenshots/images/add-site-connect.webp` (first-run): 5024 pixels differ, differences in `docs-refresh-output/diffs/add-site-connect.png`
- `docs/user/screenshots/images/add-site-import.webp` (first-run): 3159 pixels differ, differences in `docs-refresh-output/diffs/add-site-import.png`
- `docs/user/screenshots/images/create-site.webp` (first-run): 3981 pixels differ, differences in `docs-refresh-output/diffs/create-site.png`
- `docs/user/screenshots/images/create-site-advanced.webp` (first-run): 10756 pixels differ, differences in `docs-refresh-output/diffs/create-site-advanced.png`
- `docs/user/screenshots/images/create-site-https.webp` (first-run): 10756 pixels differ, differences in `docs-refresh-output/diffs/create-site-https.png`
- `docs/user/screenshots/images/orientation-guide.webp` (first-run): 1356 pixels differ, differences in `docs-refresh-output/diffs/orientation-guide.png`
- `docs/user/screenshots/images/main-window-signed-out.webp` (workspace): 11201 pixels differ, differences in `docs-refresh-output/diffs/main-window-signed-out.png`
- `docs/user/screenshots/images/main-window-signed-out-annotated.webp` (workspace): 10769 pixels differ, differences in `docs-refresh-output/diffs/main-window-signed-out-annotated.png`
- `docs/user/screenshots/images/command-palette.webp` (workspace): 1020 pixels differ, differences in `docs-refresh-output/diffs/command-palette.png`
- `docs/user/screenshots/images/preview-destinations.webp` (workspace): 645 pixels differ, differences in `docs-refresh-output/diffs/preview-destinations.png`
- `docs/user/screenshots/images/preview-destinations-annotated.webp` (workspace): 536 pixels differ, differences in `docs-refresh-output/diffs/preview-destinations-annotated.png`
- `docs/user/screenshots/images/design-system.webp` (workspace): 6907 pixels differ, differences in `docs-refresh-output/diffs/design-system.png`
- `docs/user/screenshots/images/responsive-mode-presets.webp` (workspace): the image changed size
- `docs/user/screenshots/images/responsive-mode.webp` (workspace): 14364 pixels differ, differences in `docs-refresh-output/diffs/responsive-mode.png`
- `docs/user/screenshots/images/site-status-button.webp` (workspace): 117 pixels differ, differences in `docs-refresh-output/diffs/site-status-button.png`
- `docs/user/screenshots/images/site-status-button-annotated.webp` (workspace): 117 pixels differ, differences in `docs-refresh-output/diffs/site-status-button-annotated.png`
- `docs/user/screenshots/images/site-stopped.webp` (workspace): 42845 pixels differ, differences in `docs-refresh-output/diffs/site-stopped.png`
- `docs/user/screenshots/images/site-menu.webp` (site-menu): the image changed size
- `docs/user/screenshots/images/site-menu-open-in.webp` (site-menu): the image changed size
- `docs/user/screenshots/images/site-menu-export.webp` (site-menu): the image changed size
- `docs/user/screenshots/images/delete-site-dialog.webp` (site-menu): 10686 pixels differ, differences in `docs-refresh-output/diffs/delete-site-dialog.png`
- `docs/user/screenshots/images/import-overwrite-dialog.webp` (site-menu): 372 pixels differ, differences in `docs-refresh-output/diffs/import-overwrite-dialog.png`
- `docs/user/screenshots/images/site-settings.webp` (site-settings): 206907 pixels differ, differences in `docs-refresh-output/diffs/site-settings.png`
- `docs/user/screenshots/images/site-settings-domain.webp` (site-settings): 200754 pixels differ, differences in `docs-refresh-output/diffs/site-settings-domain.png`
- `docs/user/screenshots/images/site-settings-debug.webp` (site-settings): 219294 pixels differ, differences in `docs-refresh-output/diffs/site-settings-debug.png`
- `docs/user/screenshots/images/site-settings-php.webp` (site-settings): 161509 pixels differ, differences in `docs-refresh-output/diffs/site-settings-php.png`
- `docs/user/screenshots/images/settings-general.webp` (studio-settings): 204737 pixels differ, differences in `docs-refresh-output/diffs/settings-general.png`
- `docs/user/screenshots/images/settings-studio-cli.webp` (studio-settings): 213937 pixels differ, differences in `docs-refresh-output/diffs/settings-studio-cli.png`
- `docs/user/screenshots/images/settings-ai-providers.webp` (studio-settings): 193417 pixels differ, differences in `docs-refresh-output/diffs/settings-ai-providers.png`
- `docs/user/screenshots/images/settings-skills.webp` (studio-settings): 160093 pixels differ, differences in `docs-refresh-output/diffs/settings-skills.png`
- `docs/user/screenshots/images/settings-mcp.webp` (studio-settings): 224715 pixels differ, differences in `docs-refresh-output/diffs/settings-mcp.png`
- `docs/user/screenshots/images/settings-keyboard.webp` (studio-settings): 174721 pixels differ, differences in `docs-refresh-output/diffs/settings-keyboard.png`
- `docs/user/screenshots/images/main-window-signed-in.webp` (signed-in): 6279 pixels differ, differences in `docs-refresh-output/diffs/main-window-signed-in.png`
- `docs/user/screenshots/images/account-menu.webp` (signed-in): 6640 pixels differ, differences in `docs-refresh-output/diffs/account-menu.png`
- `docs/user/screenshots/images/composer-add-menu.webp` (signed-in): the image changed size
- `docs/user/screenshots/images/annotate-toolbar.webp` (signed-in): 4339908 pixels differ, differences in `docs-refresh-output/diffs/annotate-toolbar.png`
- `docs/user/screenshots/images/annotate-note.webp` (signed-in): 153008 pixels differ, differences in `docs-refresh-output/diffs/annotate-note.png`
- `docs/user/screenshots/images/share-create-preview.webp` (signed-in): 2129 pixels differ, differences in `docs-refresh-output/diffs/share-create-preview.png`
- `docs/user/screenshots/images/publish-panel.webp` (signed-in): 2079 pixels differ, differences in `docs-refresh-output/diffs/publish-panel.png`
- `docs/user/screenshots/images/publish-choose-site.webp` (signed-in): 2129 pixels differ, differences in `docs-refresh-output/diffs/publish-choose-site.png`
- `docs/user/screenshots/images/model-menu.webp` (signed-in): the image changed size
- `docs/user/screenshots/images/add-ai-credits.webp` (signed-in): 717 pixels differ, differences in `docs-refresh-output/diffs/add-ai-credits.png`
- `docs/user/screenshots/images/settings-usage.webp` (signed-in): 196802 pixels differ, differences in `docs-refresh-output/diffs/settings-usage.png`
- `docs/user/screenshots/images/settings-sharing.webp` (signed-in): 198195 pixels differ, differences in `docs-refresh-output/diffs/settings-sharing.png`
- `docs/user/screenshots/images/settings-ai-providers-signed-in.webp` (signed-in): 195256 pixels differ, differences in `docs-refresh-output/diffs/settings-ai-providers-signed-in.png`
- `docs/user/screenshots/images/add-site-connect-signed-in.webp` (signed-in): 582 pixels differ, differences in `docs-refresh-output/diffs/add-site-connect-signed-in.png`
- `docs/user/screenshots/images/send-feedback.webp` (signed-in): 1996 pixels differ, differences in `docs-refresh-output/diffs/send-feedback.png`
- `docs/user/screenshots/images/share-previews.webp` (signed-in-previews): 2139 pixels differ, differences in `docs-refresh-output/diffs/share-previews.png`
- `docs/user/screenshots/images/share-preview-actions.webp` (signed-in-previews): 1687 pixels differ, differences in `docs-refresh-output/diffs/share-preview-actions.png`
- `docs/user/screenshots/images/publish-switcher.webp` (signed-in-connected): 2069 pixels differ, differences in `docs-refresh-output/diffs/publish-switcher.png`
- `docs/user/screenshots/images/pull-choose-files.webp` (signed-in-connected): 2133 pixels differ, differences in `docs-refresh-output/diffs/pull-choose-files.png`
- `docs/user/screenshots/images/publish-choose-files.webp` (signed-in-connected): 2079 pixels differ, differences in `docs-refresh-output/diffs/publish-choose-files.png`
- `docs/user/screenshots/images/design-looks.webp` (signed-in-agent): 3532 pixels differ, differences in `docs-refresh-output/diffs/design-looks.png`
- `docs/user/screenshots/images/workspace-chat.webp` (signed-in-chat): 3808 pixels differ, differences in `docs-refresh-output/diffs/workspace-chat.png`
- `docs/user/screenshots/images/blog-settings-appearance.webp` (signed-in-blog): 187377 pixels differ, differences in `docs-refresh-output/diffs/blog-settings-appearance.png`
