# Studio's phpMyAdmin styles

Studio uses the Bootstrap theme included with phpMyAdmin and applies a small
design layer after the theme's own stylesheet. This keeps phpMyAdmin aligned
with Studio without maintaining a fork of the upstream theme.

## How it gets installed

`scripts/download-wp-server-files.ts` downloads phpMyAdmin, applies Studio's
local files from `apps/cli/php/`, and builds `themes/studio.css` plus its RTL
variant. The download step inserts that stylesheet after the active theme in
phpMyAdmin's upstream `header.twig` and fails if its expected insertion point
has changed.

`apps/cli/php/config.inc.php` selects phpMyAdmin's bundled `bootstrap` theme as
the default. A user's theme preference can still take precedence, but Studio's
design layer is applied to every theme.

## Working on the styles

Edit the SCSS under `styles/studio/scss/`, then run:

```sh
npm run phpmyadmin:style
npm run cli:build
```

Restart the site and hard reload phpMyAdmin after rebuilding. phpMyAdmin uses
its application version as the stylesheet cache key, so changing the local
stylesheet does not change the URL.

The stylesheet follows `prefers-color-scheme` because phpMyAdmin 5.2 has no
theme-mode switcher. Electron reflects Studio's effective light or dark mode
through that media query.
