# Add site review screenshots

162 full-resolution screenshots, captured November 5, 2026.

[Main PR #5762](https://github.com/Automattic/studio/pull/5762) · [Notice PR #5761](https://github.com/Automattic/studio/pull/5761)

![Setup and source overview](overview.jpg)

Download this directory and open `index.html` for a searchable gallery with surface and color-scheme filters. The index below is directly viewable on GitHub.

## Review and verification

- Trunk `35be9e85c` was merged into the existing isolated feature worktree. Feature head: `38a7f1f9f`; notice head: `c94fd2c40`.
- Removed unused Field spacing and Popover options, private-only exports, and a stale inline-error test. Fixed restoration of automatic folder matching when a new Blueprint suggests another title.
- Modified-file lint/format, full type checking, and Knip passed.
- Standard combined suite: 463 files passed, 9 skipped; 4,746 tests passed, 48 skipped (`npm test -- --tagsFilter='!e2e' --maxWorkers=4`). After splitting the notice PR, the feature branch passed 631 focused tests across 43 files; the notice branch passed 52 tests across 2 files.
- Fresh browser and Desktop builds were checked in light/dark. Keyboard browse/remove, both tooltips, natural selected-card height, draft preservation, adaptive parent paths, reset/empty fallback, and pending-creation navigation locks passed.
- The rebuilt CLI create integration test could not fetch WordPress version data (`ECONNREFUSED`). These captures do not establish successful real-site creation, import, AI execution, Windows/Linux native pickers, or CI completion.

## Fixture boundaries

Account, provider, quota, remote-site, and empty/error/loading catalog states use fixture responses. Uploads use small test files; existing sites use test directories. Desktop uses its real IPC connector with test-selected folder paths, so the native picker itself is not shown. Creation calls are intercepted for pending/failure images. Failure persistence is supplied by #5761 and is shown with the feature UI from #5762.

## Screenshot index

### AI and account states

| State and surface | Light | Dark |
| --- | --- | --- |
| ai connected empty (browser) | [![light](images/browser-light-ai-connected-empty.png)](images/browser-light-ai-connected-empty.png) | [![dark](images/browser-dark-ai-connected-empty.png)](images/browser-dark-ai-connected-empty.png) |
| ai narrow brief (browser) | [![light](images/browser-light-ai-narrow-brief.png)](images/browser-light-ai-narrow-brief.png) | [![dark](images/browser-dark-ai-narrow-brief.png)](images/browser-dark-ai-narrow-brief.png) |
| ai out of credits (browser) | [![light](images/browser-light-ai-out-of-credits.png)](images/browser-light-ai-out-of-credits.png) | [![dark](images/browser-dark-ai-out-of-credits.png)](images/browser-dark-ai-out-of-credits.png) |
| ai payment required (browser) | [![light](images/browser-light-ai-payment-required.png)](images/browser-light-ai-payment-required.png) | [![dark](images/browser-dark-ai-payment-required.png)](images/browser-dark-ai-payment-required.png) |
| ai with brief (browser) | [![light](images/browser-light-ai-with-brief.png)](images/browser-light-ai-with-brief.png) | [![dark](images/browser-dark-ai-with-brief.png)](images/browser-dark-ai-with-brief.png) |
| connect empty account (browser) | [![light](images/browser-light-connect-empty-account.png)](images/browser-light-connect-empty-account.png) | [![dark](images/browser-dark-connect-empty-account.png)](images/browser-dark-connect-empty-account.png) |
| connect load error (browser) | [![light](images/browser-light-connect-load-error.png)](images/browser-light-connect-load-error.png) | [![dark](images/browser-dark-connect-load-error.png)](images/browser-dark-connect-load-error.png) |
| connect no matches (browser) | [![light](images/browser-light-connect-no-matches.png)](images/browser-light-connect-no-matches.png) | [![dark](images/browser-dark-connect-no-matches.png)](images/browser-dark-connect-no-matches.png) |
| connect signed out (browser) | [![light](images/browser-light-connect-signed-out.png)](images/browser-light-connect-signed-out.png) | [![dark](images/browser-dark-connect-signed-out.png)](images/browser-dark-connect-signed-out.png) |
| connect signed out (electron) | [![light](images/electron-light-connect-signed-out.png)](images/electron-light-connect-signed-out.png) | [![dark](images/electron-dark-connect-signed-out.png)](images/electron-dark-connect-signed-out.png) |
| connect sites (browser) | [![light](images/browser-light-connect-sites.png)](images/browser-light-connect-sites.png) | [![dark](images/browser-dark-connect-sites.png)](images/browser-dark-connect-sites.png) |

### Creation feedback

| State and surface | Light | Dark |
| --- | --- | --- |
| Creation failure failure (browser) | [![light](images/create-failure-toast-browser-light-failure.png)](images/create-failure-toast-browser-light-failure.png) | [![dark](images/create-failure-toast-browser-dark-failure.png)](images/create-failure-toast-browser-dark-failure.png) |
| Creation failure failure (electron) | [![light](images/create-failure-toast-electron-light-failure.png)](images/create-failure-toast-electron-light-failure.png) | [![dark](images/create-failure-toast-electron-dark-failure.png)](images/create-failure-toast-electron-dark-failure.png) |
| Creation pending 1100 pending (browser) | [![light](images/create-header-browser-light-1100-pending.png)](images/create-header-browser-light-1100-pending.png) | [![dark](images/create-header-browser-dark-1100-pending.png)](images/create-header-browser-dark-1100-pending.png) |
| Creation pending 1100 pending (electron) | [![light](images/create-header-electron-light-1100-pending.png)](images/create-header-electron-light-1100-pending.png) | [![dark](images/create-header-electron-dark-1100-pending.png)](images/create-header-electron-dark-1100-pending.png) |
| Creation pending 390 pending (browser) | [![light](images/create-header-browser-light-390-pending.png)](images/create-header-browser-light-390-pending.png) | [![dark](images/create-header-browser-dark-390-pending.png)](images/create-header-browser-dark-390-pending.png) |

### Folder and interaction states

| State and surface | Light | Dark |
| --- | --- | --- |
| Adaptive path compact (browser) | [![light](images/adaptive-parent-path-browser-light-compact.png)](images/adaptive-parent-path-browser-light-compact.png) | [![dark](images/adaptive-parent-path-browser-dark-compact.png)](images/adaptive-parent-path-browser-dark-compact.png) |
| Adaptive path compact (electron) | [![light](images/adaptive-parent-path-electron-light-compact.png)](images/adaptive-parent-path-electron-light-compact.png) | [![dark](images/adaptive-parent-path-electron-dark-compact.png)](images/adaptive-parent-path-electron-dark-compact.png) |
| Adaptive path full (browser) | [![light](images/adaptive-parent-path-browser-light-full.png)](images/adaptive-parent-path-browser-light-full.png) | [![dark](images/adaptive-parent-path-browser-dark-full.png)](images/adaptive-parent-path-browser-dark-full.png) |
| Adaptive path full (electron) | [![light](images/adaptive-parent-path-electron-light-full.png)](images/adaptive-parent-path-electron-light-full.png) | [![dark](images/adaptive-parent-path-electron-dark-full.png)](images/adaptive-parent-path-electron-dark-full.png) |
| Adaptive path narrow (browser) | [![light](images/adaptive-parent-path-browser-light-narrow.png)](images/adaptive-parent-path-browser-light-narrow.png) | [![dark](images/adaptive-parent-path-browser-dark-narrow.png)](images/adaptive-parent-path-browser-dark-narrow.png) |
| Blueprint actions 1100 selected (browser) | [![light](images/blueprint-source-actions-browser-light-1100-selected.png)](images/blueprint-source-actions-browser-light-1100-selected.png) | [![dark](images/blueprint-source-actions-browser-dark-1100-selected.png)](images/blueprint-source-actions-browser-dark-1100-selected.png) |
| Blueprint actions 1100 selected (electron) | [![light](images/blueprint-source-actions-electron-light-1100-selected.png)](images/blueprint-source-actions-electron-light-1100-selected.png) | [![dark](images/blueprint-source-actions-electron-dark-1100-selected.png)](images/blueprint-source-actions-electron-dark-1100-selected.png) |
| Blueprint actions 1100 tooltip (browser) | [![light](images/blueprint-source-actions-browser-light-1100-tooltip.png)](images/blueprint-source-actions-browser-light-1100-tooltip.png) | [![dark](images/blueprint-source-actions-browser-dark-1100-tooltip.png)](images/blueprint-source-actions-browser-dark-1100-tooltip.png) |
| Blueprint actions 1100 tooltip (electron) | [![light](images/blueprint-source-actions-electron-light-1100-tooltip.png)](images/blueprint-source-actions-electron-light-1100-tooltip.png) | [![dark](images/blueprint-source-actions-electron-dark-1100-tooltip.png)](images/blueprint-source-actions-electron-dark-1100-tooltip.png) |
| Blueprint actions 390 selected (browser) | [![light](images/blueprint-source-actions-browser-light-390-selected.png)](images/blueprint-source-actions-browser-light-390-selected.png) | [![dark](images/blueprint-source-actions-browser-dark-390-selected.png)](images/blueprint-source-actions-browser-dark-390-selected.png) |
| Blueprint actions 390 tooltip (browser) | [![light](images/blueprint-source-actions-browser-light-390-tooltip.png)](images/blueprint-source-actions-browser-light-390-tooltip.png) | [![dark](images/blueprint-source-actions-browser-dark-390-tooltip.png)](images/blueprint-source-actions-browser-dark-390-tooltip.png) |
| custom slug reset (browser) | [![light](images/browser-light-custom-slug-reset.png)](images/browser-light-custom-slug-reset.png) | [![dark](images/browser-dark-custom-slug-reset.png)](images/browser-dark-custom-slug-reset.png) |
| custom slug reset (electron) | [![light](images/electron-light-custom-slug-reset.png)](images/electron-light-custom-slug-reset.png) | [![dark](images/electron-dark-custom-slug-reset.png)](images/electron-dark-custom-slug-reset.png) |
| empty name error (browser) | [![light](images/browser-light-empty-name-error.png)](images/browser-light-empty-name-error.png) | [![dark](images/browser-dark-empty-name-error.png)](images/browser-dark-empty-name-error.png) |
| empty name error (electron) | [![light](images/electron-light-empty-name-error.png)](images/electron-light-empty-name-error.png) | [![dark](images/electron-dark-empty-name-error.png)](images/electron-dark-empty-name-error.png) |
| empty name focused (browser) | [![light](images/browser-light-empty-name-focused.png)](images/browser-light-empty-name-focused.png) | [![dark](images/browser-dark-empty-name-focused.png)](images/browser-dark-empty-name-focused.png) |
| empty name focused (electron) | [![light](images/electron-light-empty-name-focused.png)](images/electron-light-empty-name-focused.png) | [![dark](images/electron-dark-empty-name-focused.png)](images/electron-dark-empty-name-focused.png) |
| invalid blueprint (browser) | [![light](images/browser-light-invalid-blueprint.png)](images/browser-light-invalid-blueprint.png) | [![dark](images/browser-dark-invalid-blueprint.png)](images/browser-dark-invalid-blueprint.png) |
| invalid blueprint (electron) | [![light](images/electron-light-invalid-blueprint.png)](images/electron-light-invalid-blueprint.png) | [![dark](images/electron-dark-invalid-blueprint.png)](images/electron-dark-invalid-blueprint.png) |
| long title condensed parent (browser) | [![light](images/browser-light-long-title-condensed-parent.png)](images/browser-light-long-title-condensed-parent.png) | [![dark](images/browser-dark-long-title-condensed-parent.png)](images/browser-dark-long-title-condensed-parent.png) |
| long title condensed parent (electron) | [![light](images/electron-light-long-title-condensed-parent.png)](images/electron-light-long-title-condensed-parent.png) | [![dark](images/electron-dark-long-title-condensed-parent.png)](images/electron-dark-long-title-condensed-parent.png) |
| occupied destination error (electron) | [![light](images/electron-light-occupied-destination-error.png)](images/electron-light-occupied-destination-error.png) | [![dark](images/electron-dark-occupied-destination-error.png)](images/electron-dark-occupied-destination-error.png) |

### Gallery and entry states

| State and surface | Light | Dark |
| --- | --- | --- |
| blueprint details (browser) | [![light](images/browser-light-blueprint-details.png)](images/browser-light-blueprint-details.png) | [![dark](images/browser-dark-blueprint-details.png)](images/browser-dark-blueprint-details.png) |
| blueprint details (electron) | [![light](images/electron-light-blueprint-details.png)](images/electron-light-blueprint-details.png) | [![dark](images/electron-dark-blueprint-details.png)](images/electron-dark-blueprint-details.png) |
| empty workspace (browser) | [![light](images/browser-light-empty-workspace.png)](images/browser-light-empty-workspace.png) | [![dark](images/browser-dark-empty-workspace.png)](images/browser-dark-empty-workspace.png) |
| empty workspace (electron) | [![light](images/electron-light-empty-workspace.png)](images/electron-light-empty-workspace.png) | [![dark](images/electron-dark-empty-workspace.png)](images/electron-dark-empty-workspace.png) |
| gallery (browser) | [![light](images/browser-light-gallery.png)](images/browser-light-gallery.png) | [![dark](images/browser-dark-gallery.png)](images/browser-dark-gallery.png) |
| gallery (electron) | [![light](images/electron-light-gallery.png)](images/electron-light-gallery.png) | [![dark](images/electron-dark-gallery.png)](images/electron-dark-gallery.png) |
| gallery blog (browser) | [![light](images/browser-light-gallery-blog.png)](images/browser-light-gallery-blog.png) | [![dark](images/browser-dark-gallery-blog.png)](images/browser-dark-gallery-blog.png) |
| gallery blog (electron) | [![light](images/electron-light-gallery-blog.png)](images/electron-light-gallery-blog.png) | [![dark](images/electron-dark-gallery-blog.png)](images/electron-dark-gallery-blog.png) |
| gallery business (browser) | [![light](images/browser-light-gallery-business.png)](images/browser-light-gallery-business.png) | [![dark](images/browser-dark-gallery-business.png)](images/browser-dark-gallery-business.png) |
| gallery business (electron) | [![light](images/electron-light-gallery-business.png)](images/electron-light-gallery-business.png) | [![dark](images/electron-dark-gallery-business.png)](images/electron-dark-gallery-business.png) |
| gallery development (browser) | [![light](images/browser-light-gallery-development.png)](images/browser-light-gallery-development.png) | [![dark](images/browser-dark-gallery-development.png)](images/browser-dark-gallery-development.png) |
| gallery development (electron) | [![light](images/electron-light-gallery-development.png)](images/electron-light-gallery-development.png) | [![dark](images/electron-dark-gallery-development.png)](images/electron-dark-gallery-development.png) |
| gallery empty catalog (browser) | [![light](images/browser-light-gallery-empty-catalog.png)](images/browser-light-gallery-empty-catalog.png) | [![dark](images/browser-dark-gallery-empty-catalog.png)](images/browser-dark-gallery-empty-catalog.png) |
| gallery events (browser) | [![light](images/browser-light-gallery-events.png)](images/browser-light-gallery-events.png) | [![dark](images/browser-dark-gallery-events.png)](images/browser-dark-gallery-events.png) |
| gallery events (electron) | [![light](images/electron-light-gallery-events.png)](images/electron-light-gallery-events.png) | [![dark](images/electron-dark-gallery-events.png)](images/electron-dark-gallery-events.png) |
| gallery load error (browser) | [![light](images/browser-light-gallery-load-error.png)](images/browser-light-gallery-load-error.png) | [![dark](images/browser-dark-gallery-load-error.png)](images/browser-dark-gallery-load-error.png) |
| gallery loading (browser) | [![light](images/browser-light-gallery-loading.png)](images/browser-light-gallery-loading.png) | [![dark](images/browser-dark-gallery-loading.png)](images/browser-dark-gallery-loading.png) |
| gallery no matches (browser) | [![light](images/browser-light-gallery-no-matches.png)](images/browser-light-gallery-no-matches.png) | [![dark](images/browser-dark-gallery-no-matches.png)](images/browser-dark-gallery-no-matches.png) |
| gallery portfolio (browser) | [![light](images/browser-light-gallery-portfolio.png)](images/browser-light-gallery-portfolio.png) | [![dark](images/browser-dark-gallery-portfolio.png)](images/browser-dark-gallery-portfolio.png) |
| gallery portfolio (electron) | [![light](images/electron-light-gallery-portfolio.png)](images/electron-light-gallery-portfolio.png) | [![dark](images/electron-dark-gallery-portfolio.png)](images/electron-dark-gallery-portfolio.png) |
| gallery store (browser) | [![light](images/browser-light-gallery-store.png)](images/browser-light-gallery-store.png) | [![dark](images/browser-dark-gallery-store.png)](images/browser-dark-gallery-store.png) |
| gallery store (electron) | [![light](images/electron-light-gallery-store.png)](images/electron-light-gallery-store.png) | [![dark](images/electron-dark-gallery-store.png)](images/electron-dark-gallery-store.png) |
| import empty (browser) | [![light](images/browser-light-import-empty.png)](images/browser-light-import-empty.png) | [![dark](images/browser-dark-import-empty.png)](images/browser-dark-import-empty.png) |
| import empty (electron) | [![light](images/electron-light-import-empty.png)](images/electron-light-import-empty.png) | [![dark](images/electron-dark-import-empty.png)](images/electron-dark-import-empty.png) |

### Setup and sources

| State and surface | Light | Dark |
| --- | --- | --- |
| backup (browser) | [![light](images/browser-light-backup.png)](images/browser-light-backup.png) | [![dark](images/browser-dark-backup.png)](images/browser-dark-backup.png) |
| backup (electron) | [![light](images/electron-light-backup.png)](images/electron-light-backup.png) | [![dark](images/electron-dark-backup.png)](images/electron-dark-backup.png) |
| blank default (browser) | [![light](images/browser-light-blank-default.png)](images/browser-light-blank-default.png) | [![dark](images/browser-dark-blank-default.png)](images/browser-dark-blank-default.png) |
| blank default (electron) | [![light](images/electron-light-blank-default.png)](images/electron-light-blank-default.png) | [![dark](images/electron-dark-blank-default.png)](images/electron-dark-blank-default.png) |
| catalog blueprint (browser) | [![light](images/browser-light-catalog-blueprint.png)](images/browser-light-catalog-blueprint.png) | [![dark](images/browser-dark-catalog-blueprint.png)](images/browser-dark-catalog-blueprint.png) |
| catalog blueprint (electron) | [![light](images/electron-light-catalog-blueprint.png)](images/electron-light-catalog-blueprint.png) | [![dark](images/electron-dark-catalog-blueprint.png)](images/electron-dark-catalog-blueprint.png) |
| connected site source (browser) | [![light](images/browser-light-connected-site-source.png)](images/browser-light-connected-site-source.png) | [![dark](images/browser-dark-connected-site-source.png)](images/browser-dark-connected-site-source.png) |
| custom destination (electron) | [![light](images/electron-light-custom-destination.png)](images/electron-light-custom-destination.png) | [![dark](images/electron-dark-custom-destination.png)](images/electron-dark-custom-destination.png) |
| existing wordpress (electron) | [![light](images/electron-light-existing-wordpress.png)](images/electron-light-existing-wordpress.png) | [![dark](images/electron-dark-existing-wordpress.png)](images/electron-dark-existing-wordpress.png) |
| existing wordpress changed (electron) | [![light](images/electron-light-existing-wordpress-changed.png)](images/electron-light-existing-wordpress-changed.png) | [![dark](images/electron-dark-existing-wordpress-changed.png)](images/electron-dark-existing-wordpress-changed.png) |
| existing wordpress removed (electron) | [![light](images/electron-light-existing-wordpress-removed.png)](images/electron-light-existing-wordpress-removed.png) | [![dark](images/electron-dark-existing-wordpress-removed.png)](images/electron-dark-existing-wordpress-removed.png) |
| narrow blank (browser) | [![light](images/browser-light-narrow-blank.png)](images/browser-light-narrow-blank.png) | [![dark](images/browser-dark-narrow-blank.png)](images/browser-dark-narrow-blank.png) |
| narrow blueprint (browser) | [![light](images/browser-light-narrow-blueprint.png)](images/browser-light-narrow-blueprint.png) | [![dark](images/browser-dark-narrow-blueprint.png)](images/browser-dark-narrow-blueprint.png) |
| uploaded bundle (browser) | [![light](images/browser-light-uploaded-bundle.png)](images/browser-light-uploaded-bundle.png) | [![dark](images/browser-dark-uploaded-bundle.png)](images/browser-dark-uploaded-bundle.png) |
| uploaded bundle (electron) | [![light](images/electron-light-uploaded-bundle.png)](images/electron-light-uploaded-bundle.png) | [![dark](images/electron-dark-uploaded-bundle.png)](images/electron-dark-uploaded-bundle.png) |
| uploaded json (browser) | [![light](images/browser-light-uploaded-json.png)](images/browser-light-uploaded-json.png) | [![dark](images/browser-dark-uploaded-json.png)](images/browser-dark-uploaded-json.png) |
| uploaded json (electron) | [![light](images/electron-light-uploaded-json.png)](images/electron-light-uploaded-json.png) | [![dark](images/electron-dark-uploaded-json.png)](images/electron-dark-uploaded-json.png) |
| wordpress export (browser) | [![light](images/browser-light-wordpress-export.png)](images/browser-light-wordpress-export.png) | [![dark](images/browser-dark-wordpress-export.png)](images/browser-dark-wordpress-export.png) |
| wordpress export (electron) | [![light](images/electron-light-wordpress-export.png)](images/electron-light-wordpress-export.png) | [![dark](images/electron-dark-wordpress-export.png)](images/electron-dark-wordpress-export.png) |

