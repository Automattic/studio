# Backup fixtures

Backup archives used by `import-formats.test.ts` to cover the Local,
Playground and All-in-One WP Migration (`.wpress`) import formats.

All three were generated from the same demo Studio site — blog name **MyPet**
(`page.title()` assertions rely on it) — containing a small custom theme
(`mypet-theme`), the stock plugins, and a handful of published posts. They
carry no personal data: the only user is `admin <admin@localhost.com>`.

| File | Format | Structure |
| --- | --- | --- |
| `local-backup.zip` | Local (by Flywheel) | `app/sql/local.sql` + `app/public/wp-content/*` |
| `playground-backup.zip` | WordPress Playground | `wp-content/*` incl. `wp-content/database/.ht.sqlite` |
| `aio-backup.wpress` | All-in-One WP Migration | `database.sql` + `package.json` + wp-content children at the root |

The expected structure for each format is defined by the validators in
`apps/cli/lib/import-export/import/validators/`. The `.wpress` binary layout
(4377-byte per-file headers, zero-filled EOF header) is documented in
`apps/cli/lib/import-export/import/handlers/backup-handler-wpress.ts`.
