# @studio/database

The databases WordPress sites run on in Studio, SQLite or a MySQL server, worked on the same way. It knows nothing about Studio sites: it takes a connection, which says where a database is, and gives one implementation per engine. It imports no other workspace package.

```
index.ts       the browser-safe entry
engine.ts      databaseEngineSchema, DatabaseEngine
connection.ts  DatabaseConnection and its schema, parseDbHost, formatDbHost
errors.ts      DatabaseError
node.ts        the Node entry
database.ts    createDatabase, Database
session.ts     DatabaseSession, the error handling around each engine
sqlite.ts      the SQLite engine (node:sqlite), copySqliteDatabase
mysql.ts       the MySQL engine (mysql2, loaded only when a MySQL database is opened)
```

## Connections

A `DatabaseConnection` says where a database is: `{ engine: 'sqlite', path }` or `{ engine: 'mysql', host, port, user, password, database }`. `databaseConnectionSchema` checks one, for instance when it crosses a process boundary.

`parseDbHost` and `formatDbHost` convert between a WordPress `DB_HOST` value (`host` or `host:port`) and a host and port. WordPress in Studio reaches MySQL over TCP, so a socket, and `localhost`, which PHP takes as a socket, throw a `socket_host` error.

## Working on a database

```ts
import { createDatabase } from '@studio/database/node';

const database = createDatabase( connection ); // opens nothing
if ( ! ( await database.exists() ) ) {
	await database.create();
}
await using session = await database.open();
const rows = await session.query( 'SELECT option_value FROM wp_options WHERE option_name = ?', [ 'blogname' ] );
for ( const table of await session.tables() ) {
	for await ( const row of session.tableRows( table ) ) {
		// one row at a time, in a stable order
	}
}
```

A `Database`:

- `exists()` and `create()`: the SQLite file (`create` makes its folder; SQLite creates the file on first write), or the database on its MySQL server.
- `open( { readOnly } )` returns a `DatabaseSession`: `query` runs one statement with `?` placeholders, `rows` yields rows one at a time, `tables` lists the tables (on SQLite, including the SQLite driver's own), `tableRows` reads a table in a stable order (`rowid` on SQLite, the primary key on MySQL). SQL isn't translated: write SQL both engines accept, or check `connection.engine`.
- `prepareForSharing()` gets the database ready for several processes to open at once, then repairs it: on SQLite, it leaves the WAL journal mode the driver leaves it in, which processes sharing a site's database trip over. Only while none has it open.
- `repair()` fixes what WordPress's SQLite driver records wrongly: the MySQL 8-only collations, which MariaDB rejects when an export is imported. Safe while the database is in use.

Both do nothing on MySQL and never throw: they only leave the problem in place.

`copySqliteDatabase( source, destination )` copies a SQLite database consistently while a site writes to it.

Failures throw a `DatabaseError` with a translated message and a `code`: `connection_failed` when a database can't be opened, `query_failed` when a statement fails.

## Tests

`npm test -- packages/database`. Set `STUDIO_TEST_MYSQL_URL` (e.g. `mysql://root:secret@127.0.0.1:3307`) to run them against MySQL too: they create and drop their own database.
