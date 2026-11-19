import { getSiteDatabasePath } from 'cli/lib/sqlite-collations';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import type { SiteDatabase } from 'cli/lib/database';

export function createSqliteDatabase( sitePath: string ) {
	return {
		engine: 'sqlite',
		// Also leaves alone the sites people moved to their own database server by hand before
		// Studio supported MySQL: they have a wp-config.php and none of the SQLite files.
		ensureReady: () => keepSqliteIntegrationUpdated( sitePath ),
		getConnection: async () => ( { engine: 'sqlite', path: getSiteDatabasePath( sitePath ) } ),
	} satisfies SiteDatabase;
}
