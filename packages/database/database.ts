import { createMysqlDatabase } from './mysql';
import { createSqliteDatabase } from './sqlite';
import type { DatabaseConnection } from './connection';
import type { DatabaseSession } from './session';

export interface OpenOptions {
	/** Opens a SQLite file read-only, so a missing file fails instead of being created. */
	readOnly?: boolean;
}

/** A database, SQLite or MySQL, worked on the same way. Creating one opens nothing. */
export interface Database {
	readonly connection: DatabaseConnection;
	/** Whether it exists: the SQLite file, or the database on its MySQL server. */
	exists(): Promise< boolean >;
	/** Creates it unless it exists: the SQLite file's folder, or the database on its MySQL server. */
	create(): Promise< void >;
	/** Opens it. Throws a `connection_failed` DatabaseError. */
	open( options?: OpenOptions ): Promise< DatabaseSession >;
	/**
	 * Fixes what WordPress's SQLite driver records wrongly, and is safe while the database is in
	 * use. Nothing to do on MySQL. Never throws: it only leaves the problem in place.
	 */
	repair(): Promise< void >;
	/**
	 * Gets the database ready to be opened by several processes at once, then repairs it. Only
	 * while none has it open. Nothing to do on MySQL. Never throws.
	 */
	prepareForSharing(): Promise< void >;
}

export function createDatabase( connection: DatabaseConnection ): Database {
	return connection.engine === 'sqlite'
		? createSqliteDatabase( connection )
		: createMysqlDatabase( connection );
}
