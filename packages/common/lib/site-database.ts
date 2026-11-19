import { z } from 'zod';

export const databaseEngineSchema = z.enum( [ 'sqlite', 'mysql' ] );
export type DatabaseEngine = z.infer< typeof databaseEngineSchema >;

// Not `localhost`, which PHP's MySQL driver takes as a socket connection.
export const DEFAULT_MYSQL_HOST = '127.0.0.1';

// Studio saves the engine only for sites on a MySQL server, so every other site runs on SQLite.
export function getDatabaseEngine( site: { databaseEngine?: DatabaseEngine } ): DatabaseEngine {
	return site.databaseEngine ?? 'sqlite';
}
