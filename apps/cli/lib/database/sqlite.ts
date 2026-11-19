import {
	getSqliteDatabasePath,
	installSqliteIntegration,
	isSqliteIntegrationInstalled,
	updateSqliteIntegration,
} from '@studio/database/node';
import { getSqlitePluginPath } from 'cli/lib/dependency-management/paths';
import type { SiteDatabase } from 'cli/lib/database';

export function createSqliteSiteDatabase( sitePath: string ) {
	return {
		engine: 'sqlite',
		// Also leaves alone the sites people moved to their own database server by hand before
		// Studio supported MySQL: they have a wp-config.php and none of the SQLite files.
		ensureReady: () => updateSqliteIntegration( sitePath, getSqlitePluginPath() ),
		getConnection: async () => ( { engine: 'sqlite', path: getSqliteDatabasePath( sitePath ) } ),
	} satisfies SiteDatabase;
}

/**
 * Sites pulled with Reprint wire SQLite through runtime.php and ship no db.php drop-in, so
 * updateSqliteIntegration leaves them alone; tools that find the integration in wp-content
 * (e.g. `wp sqlite export`) need it installed first.
 */
export async function ensureSqliteIntegrationForImportedSite( site: {
	path: string;
	runtimeBlueprintPath?: string;
} ): Promise< void > {
	if ( site.runtimeBlueprintPath && ! isSqliteIntegrationInstalled( site.path ) ) {
		await installSqliteIntegration( site.path, getSqlitePluginPath() );
	}
}
