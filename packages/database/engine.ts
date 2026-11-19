import { z } from 'zod';

export const databaseEngineSchema = z.enum( [ 'sqlite', 'mysql' ] );
export type DatabaseEngine = z.infer< typeof databaseEngineSchema >;

/** Studio records the engine only for sites on a MySQL server, so every other site runs on SQLite. */
export function getDatabaseEngine( site: { databaseEngine?: DatabaseEngine } ): DatabaseEngine {
	return site.databaseEngine ?? 'sqlite';
}
