/**
 * WordPress runs on SQLite through the SQLite Database Integration plugin: a `db.php` drop-in
 * that loads its driver from `wp-content/mu-plugins/sqlite-database-integration`, and a
 * database file in `wp-content/database`.
 */
export const SQLITE_INTEGRATION_FOLDER = 'sqlite-database-integration';

/** The wp-config.php constants the SQLite driver needs: it fails on an empty DB_NAME. */
export const SQLITE_WP_CONFIG_CONSTANTS = { DB_NAME: 'wordpress' } as const;
