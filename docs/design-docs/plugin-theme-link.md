# Plugin and theme link — CLI feature

## Summary

Developers working on a WordPress plugin or theme commonly maintain a single source directory outside any specific Studio site (for example `~/Developer/wp-plugins/secure-custom-fields`) and need to try that code against multiple local sites: different WordPress versions, PHP versions, themes, or datasets.

Copying the source into each site's `wp-content/plugins` directory breaks the feedback loop — edits land in a copy and need to be kept in sync by hand. This feature adds a set of CLI commands that create and manage symbolic links from a site's `wp-content/plugins` or `wp-content/themes` directory to an external source directory.

## Commands

| Command | Purpose |
|---------|---------|
| `studio plugin link [source]` | Link an external plugin directory into a Studio site |
| `studio plugin unlink [plugin]` | Remove a plugin symlink from a site (source files untouched) |
| `studio plugin list-linked` | List every linked plugin inside a site (table or `--format json`) |
| `studio theme link [source]` | Link an external theme directory into a Studio site |
| `studio theme unlink [theme]` | Remove a theme symlink from a site |
| `studio theme list-linked` | List every linked theme inside a site |

### Default arguments

- `link` without `[source]` uses the current working directory as the source.
- `unlink` without `[plugin]` / `[theme]` uses the basename of the current working directory as the symlink name to remove.

### Site resolution

When `--path` resolves to a directory that is not a registered Studio site — for example when the terminal is inside a plugin folder — and standard input is a TTY, the CLI opens a searchable picker listing every local site registered in `~/.studio/cli.json`. The chosen site's path becomes the target for the link or unlink operation. In non-interactive shells the original "specified directory is not added to Studio" error is preserved so automation fails loud.

## Validation

Before creating a symlink the CLI verifies that the source directory looks like a real WordPress plugin or theme:

- **Plugin**: at least one `*.php` file in the source root contains a `Plugin Name:` header.
- **Theme**: a `style.css` at the source root contains a `Theme Name:` header.

If the target directory inside the site already exists the CLI distinguishes between three cases:

- An existing symlink pointing to the same source → reported as "already linked" and the command exits success.
- An existing symlink pointing to a different source → a `LoggerError` is raised so the user can decide whether to unlink first.
- A regular (non-symlink) directory → a `LoggerError` is raised recommending removal before linking.

## Cross-platform behavior

- **macOS / Linux**: the link is created with `fs.promises.symlink` using a relative path computed with `path.relative( dirname( target ), source )`. Relative symlinks travel with the site if the user moves it along with its source.
- **Windows**: the same call is attempted first. If it fails with `EPERM` (symlinks require elevated privileges or Developer Mode on Windows), the CLI falls back to a directory junction created with `fs.promises.symlink( resolve( source ), target, 'junction' )`. Junctions do not require admin privileges but only work with absolute paths to directories on the same volume.

## Safety

`unlink` always removes the symlink node only — it never touches the files at the resolved source path. The command refuses to operate on a real (non-symlink) directory, surfacing instead a hint to use `studio wp plugin delete` or `studio wp theme delete`.

## Related files

- `apps/cli/commands/plugin/{link,unlink,list-linked}.ts`
- `apps/cli/commands/theme/{link,unlink,list-linked}.ts`
- `apps/cli/lib/local-site-picker.ts` — interactive site picker used when `--path` does not resolve
- `apps/cli/index.ts` — registers the `plugin` and `theme` subcommands
- `tools/common/logger-actions.ts` — telemetry actions `PluginCommandLoggerAction` and `ThemeCommandLoggerAction`

## Testing

Unit tests live under `apps/cli/commands/{plugin,theme}/tests/*.test.ts` and cover:

- Valid source directory detection for both plugins and themes
- All error paths (missing source, non-directory source, invalid plugin/theme structure, already-linked-to-same-source, already-linked-to-different-source, non-symlink collision)
- Windows junction fallback on `EPERM`
- `unlink` refusing to operate on non-symlink directories
- `list-linked` filtering to symlinks only and respecting `--format json`

Manual test flow:

```bash
mkdir -p /tmp/test-plugin
cat > /tmp/test-plugin/test-plugin.php <<'PHP'
<?php
/** Plugin Name: Test Plugin */
PHP

cd /tmp/test-plugin
studio plugin link                                            # picker appears → choose a site
studio plugin list-linked --path ~/Studio/<picked-site>
studio plugin unlink                                          # plugin name defaults to "test-plugin"
```
