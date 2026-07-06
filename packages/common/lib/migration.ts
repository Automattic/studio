/**
 * Interface for data migrations.
 *
 * Each migration declares whether it needs to run and how to run.
 * If `needsToRun` returns true but `run` throws, the error propagates
 * to the caller — the CLI or Studio app should handle it accordingly.
 */
export interface Migration {
	needsToRun: () => Promise< boolean >;
	run: () => Promise< void >;
}

/**
 * Executes all migrations that need to run, in order.
 * Throws on the first migration that fails.
 */
export async function runMigrations( migrations: Migration[] ): Promise< void > {
	for ( const migration of migrations ) {
		if ( await migration.needsToRun() ) {
			await migration.run();
		}
	}
}
