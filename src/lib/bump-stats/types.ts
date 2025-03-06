export enum StatsGroup {
	STUDIO_APP_LAUNCH = 'studio-app-launch-first',
	STUDIO_APP_LAUNCH_TOTAL = 'studio-app-launch-total',
	STUDIO_APP_LAUNCH_UNIQUE = 'local-environment-launch-uniques',
	STUDIO_IMPORT = 'studio-app-import',
	STUDIO_EXPORT = 'studio-app-export',
}

export enum StatsMetric {
	SUCCESS = 'success',
	FAILURE = 'failure',
	// Export button types
	FULL_SITE = 'full-site',
	DATABASE_ONLY = 'database-only',
	// Platforms
	DARWIN = 'darwin',
	LINUX = 'linux',
	WINDOWS = 'win32',
	// Importer types
	JETPACK_IMPORTER = 'JetpackImporter',
	LOCAL_IMPORTER = 'LocalImporter',
	SQL_IMPORTER = 'SQLImporter',
	PLAYGROUND_IMPORTER = 'PlaygroundImporter',
	WPRESS_IMPORTER = 'WpressImporter',
	UNKNOWN_IMPORTER = 'UnknownImporter',
}

export type AggregateInterval = 'daily' | 'weekly' | 'monthly';

export function getPlatformMetric( platform: typeof process.platform ): StatsMetric {
	switch ( platform ) {
		case 'darwin':
			return StatsMetric.DARWIN;
		case 'linux':
			return StatsMetric.LINUX;
		case 'win32':
			return StatsMetric.WINDOWS;
		default:
			throw new Error( `Unsupported platform: ${ process.platform }` );
	}
}

export function getImporterMetric( importer?: string ): StatsMetric {
	switch ( importer ) {
		case 'JetpackImporter':
			return StatsMetric.JETPACK_IMPORTER;
		case 'LocalImporter':
			return StatsMetric.LOCAL_IMPORTER;
		case 'SQLImporter':
			return StatsMetric.SQL_IMPORTER;
		case 'PlaygroundImporter':
			return StatsMetric.PLAYGROUND_IMPORTER;
		case 'WpressImporter':
			return StatsMetric.WPRESS_IMPORTER;
		default:
			return StatsMetric.UNKNOWN_IMPORTER;
	}
}
