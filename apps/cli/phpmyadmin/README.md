# Studio's phpMyAdmin styles

Studio uses the Bootstrap theme included with phpMyAdmin and applies a small
design layer after the theme's own stylesheet. This keeps phpMyAdmin aligned
with Studio without maintaining a fork of the upstream theme.

## How it gets installed

`scripts/download-wp-server-files.ts` downloads phpMyAdmin, applies Studio's
local files from `apps/cli/php/`, and builds `themes/studio.css` plus its RTL
variant. phpMyAdmin's supported custom-header include loads the stylesheet after
the active theme when the Studio database appearance is enabled.

`apps/cli/php/config.inc.php` selects phpMyAdmin's bundled `bootstrap` theme as
the fixed base theme. Studio disables phpMyAdmin's theme picker so the design
layer is always applied against the theme it targets. Choosing phpMyAdmin in
Studio's global settings restores phpMyAdmin's default theme and interface
options instead. Studio mode also collapses the navigation tree, disables
prefix grouping, and hides server-only details that add little value for a
single local WordPress database.

## Working on the styles

Edit the SCSS under `styles/studio/scss/`, then run:

```sh
npm run phpmyadmin:style
npm run cli:build
```

Restart the site after rebuilding. The stylesheet's modification time is used
as its cache key, so a normal reload picks up a newly built version.

The stylesheet follows `prefers-color-scheme` because phpMyAdmin 5.2 has no
theme-mode switcher. Electron reflects Studio's effective light or dark mode
through that media query.
