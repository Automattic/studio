# Studio's phpMyAdmin theme

Source for the `studio` phpMyAdmin theme. Studio serves phpMyAdmin at
`/phpmyadmin` on each site's port, and in the Agentic UI it renders inside the
preview pane's Database realm — so it is styled with the same
`@wordpress/theme` (`--wpds-*`) tokens as `apps/ui`.

## How it gets installed

`scripts/download-wp-server-files.ts` (which runs on `postinstall`) downloads
phpMyAdmin, **deletes `wp-files/phpmyadmin/` entirely**, unpacks the new copy,
re-applies Studio's PHP patches from `apps/cli/php/`, and then calls
`scripts/build-phpmyadmin-theme.ts` to compile this directory into
`wp-files/phpmyadmin/themes/studio/`. From there the CLI build copies all of
`wp-files/` into the bundle, so no packaging changes are needed.

The theme is selected by `$cfg['ThemeDefault'] = 'studio'` in
`apps/cli/php/config.inc.php`. phpMyAdmin's theme picker stays enabled, and a
user's choice (stored in the `pma_theme` cookie) takes precedence over that
default.

## Working on the theme

`css/` is generated — edit `scss/` and rebuild:

```sh
npm run phpmyadmin:theme   # recompiles into wp-files/phpmyadmin/themes/studio
npm run cli:build          # copies wp-files into the CLI bundle
```

Restart the site afterwards (`studio site stop && studio site start`); phpMyAdmin
cache-busts `theme.css` with the phpMyAdmin version only, so a hard reload is
needed when iterating within one version.

Bootstrap resolves through the compiler's load path, so `_bootstrap.scss` imports
`bootstrap/scss/…` rather than a relative path. `bootstrap` is pinned exactly in
the root `package.json` because it is a compile-time input to the shipped CSS.

## Supporting two phpMyAdmin versions

The theme was authored against phpMyAdmin 6.0; Studio currently ships **5.2.3**
(the version comes from `@wp-playground/tools`). `theme.json` therefore declares
`"supports": ["5.2", "6.0"]` — phpMyAdmin drops any theme whose `supports` list
omits the running series, and `ThemeDefault` then fails loudly.

Two places account for the version gap:

- The build script sets `$color-mode-type: media-query`, so Bootstrap emits its
  dark mode behind `prefers-color-scheme` instead of `[data-bs-theme=dark]`.
  6.0 has a colour-mode switcher that writes that attribute; 5.2 has none, so an
  attribute-keyed dark mode would never engage. The media query also suits
  Studio better — Electron mirrors the app's light/dark/system preference into
  it, so the theme follows the Studio setting and not just the OS. It lives in
  the build script rather than `_variables.scss` because the attribute form is
  the right choice on 6.0, and the `scss/` tree is shared with that version.
- `_topbar.scss` neutralises `.navbar.bg-light`, which 5.2's `top_menu.twig`
  still uses. It is a fixed-light Bootstrap utility carrying `!important`, so
  without the override the tab bar stays light in dark mode. 6.0 dropped it.

Apart from `_bootstrap.scss` — whose imports are rewritten to resolve through
the load path — `scss/` is intended to stay in sync with the upstream theme.
