export type ConfigData = Record< string, unknown > & { version?: number };

export interface ConfigMigration {
	version: number;
	migrate: ( data: ConfigData ) => ConfigData;
}

/**
 * Applies pending migrations to config data based on its version field.
 * Returns the transformed data with an updated version, or the original
 * data unchanged if no migrations are needed.
 *
 * Migrations must have unique, ascending version numbers.
 */
export function applyMigrations( data: ConfigData, migrations: ConfigMigration[] ): ConfigData {
	const currentVersion = data.version ?? 1;
	const pending = migrations
		.filter( ( m ) => m.version > currentVersion )
		.sort( ( a, b ) => a.version - b.version );

	if ( pending.length === 0 ) {
		return data;
	}

	let result = { ...data };
	for ( const m of pending ) {
		result = m.migrate( result );
		result.version = m.version;
	}

	return result;
}
