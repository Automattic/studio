# @studio/database

The databases WordPress sites run on in Studio: a SQLite file, which is the default, or the user's own MySQL server. It opens and queries both the same way, and sets up the SQLite integration that lets WordPress run on SQLite. It imports no other workspace package.

```
index.ts               the browser-safe entry
engine.ts              DatabaseEngine, getDatabaseEngine
connection.ts          DatabaseConnection, parseDbHost, formatDbHost
errors.ts              DatabaseError
wp-config.ts           hasDefaultDbConstants, removeDefaultDbConstants
node.ts                the Node entry
open.ts                openDatabase, Database, createMysqlDatabase
sqlite-integration.ts  the SQLite integration in a site
sqlite-files.ts        resetSqliteJournalMode, replaceMysql8OnlyCollations, copySqliteDatabase
```

## Two entries

- **`@studio/database`** runs in Node and in the page: types, the engine, `DB_HOST` values and `wp-config.php` text.
- **`@studio/database/node`** opens databases and changes site files. The CLI imports it.

## Engines and connections

A site records its engine only when it isn't SQLite, so `getDatabaseEngine( site )` reads a missing one as `sqlite`. A `DatabaseConnection` says where a database is: `{ engine: 'sqlite', path }` or `{ engine: 'mysql', host, port, user, password, database }`.

`parseDbHost` and `formatDbHost` convert between a WordPress `DB_HOST` value (`host` or `host:port`) and a host and port. WordPress in Studio reaches MySQL over TCP, so a socket, and `localhost`, which PHP takes as a socket, throw a `socket_host` error.

## Opening a database

```ts
import { openDatabase } from '@studio/database/node';

await using database = await openDatabase( connection );
const rows = await database.query( 'SELECT option_value FROM wp_options WHERE option_name = ?', [ 'blogname' ] );
for await ( const row of database.rows( 'SELECT * FROM wp_posts' ) ) {
	// one row at a time
}
```

`openDatabase( connection, { readOnly } )` opens a SQLite file with `node:sqlite`, waiting up to five seconds for a running site's write, or connects to MySQL with `mysql2`, loaded only then. `query` runs one statement with `?` placeholders and returns the rows it selects; `rows` yields them one at a time, for tables too large to hold in memory. SQL itself isn't translated: write SQL both engines accept, or check `database.connection.engine`.

Failures throw a `DatabaseError` with a translated message and a `code`: `connection_failed` when the database can't be opened, `query_failed` when a statement fails.

`createMysqlDatabase( connection )` creates the connection's database on its server unless it exists.

## The SQLite integration

WordPress runs on SQLite through the SQLite Database Integration plugin: a `db.php` drop-in that loads the driver from `wp-content/mu-plugins/sqlite-database-integration`, and the database in `wp-content/database/.ht.sqlite` (`getSqliteDatabasePath`).

- `updateSqliteIntegration( sitePath, pluginPath )` installs or refreshes it on a site that runs on SQLite. It leaves alone a site moved to its own database server by hand, which has a `wp-config.php` and none of the SQLite files (`needsSqliteIntegration`).
- `installSqliteIntegration( sitePath, pluginPath )` installs it regardless. A custom SQLite drop-in (one defining `SQLITE_DB_DROPIN_VERSION` without the stock header) is kept; any other `db.php` is replaced.

## SQLite files

- `resetSqliteJournalMode( path )` switches a database out of WAL mode, which processes sharing a site's database trip over.
- `replaceMysql8OnlyCollations( path )` rewrites the MySQL 8-only collations the driver records, which MariaDB rejects on import.
- `copySqliteDatabase( source, destination )` copies a database consistently while a site writes to it.

The first two never throw: they are fix-ups that mustn't block a start or an import.

## Tests

`npm test -- packages/database`. Set `STUDIO_TEST_MYSQL_URL` (e.g. `mysql://root:secret@127.0.0.1:3307`) to run `openDatabase` against MySQL too: the tests create and drop their own database.
