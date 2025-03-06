export enum STATS_GROUP {
	STUDIO_APP_LAUNCH = 'studio-app-launch-first',
	STUDIO_APP_LAUNCH_TOTAL = 'studio-app-launch-total',
	STUDIO_APP_LAUNCH_UNIQUE = 'local-environment-launch-uniques',
	STUDIO_IMPORT = 'studio-app-import',
	STUDIO_EXPORT = 'studio-app-export',
}

export enum STATS_METRIC {
	SUCCESS = 'success',
	FAILURE = 'failure',
	// Export button types
	FULL_SITE = 'full-site',
	DATABASE_ONLY = 'database-only',
	// Importer types
	JETPACK_IMPORTER = 'JetpackImporter',
	LOCAL_IMPORTER = 'LocalImporter',
	SQL_IMPORTER = 'SQLImporter',
	PLAYGROUND_IMPORTER = 'PlaygroundImporter',
	WPRESS_IMPORTER = 'WpressImporter',
	UNKNOWN_IMPORTER = 'UnknownImporter',
}

export type AggregateInterval = 'daily' | 'weekly' | 'monthly';

export type StatsGroup = ( typeof STATS_GROUP )[ keyof typeof STATS_GROUP ];
export type StatsMetric =
	| ( typeof STATS_METRIC )[ keyof typeof STATS_METRIC ]
	| typeof process.platform;
