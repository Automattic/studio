# Backup fixtures

Backup archives used by `import-formats.test.ts` to cover the Jetpack, Local,
Playground and All-in-One WP Migration (`.wpress`) import formats.

All three were generated from the same demo Studio site — blog name **MyPet**
(`page.title()` assertions rely on it) — containing a small custom theme
(`mypet-theme`), the stock plugins, and a handful of published posts. They
carry no personal data: the only user is `admin <admin@localhost.com>`.

| File | Format | Structure |
| --- | --- | --- |
| `jetpack-backup.tar.gz` | Jetpack Backup | per-table `sql/wp_*.sql` files + `wp-content/*` + `meta.json` |
| `local-backup.zip` | Local (by Flywheel) | `app/sql/local.sql` + `app/public/wp-content/*` |
| `playground-backup.zip` | WordPress Playground | `wp-content/*` incl. `wp-content/database/.ht.sqlite` |
| `aio-backup.wpress` | All-in-One WP Migration | `database.sql` + `package.json` + wp-content children at the root |
| `playground-randomized-database.zip` | WordPress Playground | `wp-content/database/db-path.php` + `wp-content/database/.ht.<token>/.ht.sqlite` |

`playground-randomized-database.zip` is a real export from
playground.wordpress.net, not the demo site, with its theme and `debug.log`
removed to keep it small. It covers the randomized database layout Playground
has used since SQLite Database Integration 3.1.

The expected structure for each format is defined by the validators in
`apps/cli/lib/import-export/import/validators/`. The `.wpress` binary layout
(4377-byte per-file headers, zero-filled EOF header) is documented in
`apps/cli/lib/import-export/import/handlers/backup-handler-wpress.ts`.
