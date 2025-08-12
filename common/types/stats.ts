export enum StatsGroup {
	// Studio app
	STUDIO_APP_LAUNCH = 'studio-app-launch-first',
	STUDIO_APP_LAUNCH_TOTAL = 'studio-app-launch-total',
	STUDIO_APP_LAUNCH_UNIQUE = 'studio-app-launch-uniques',
	STUDIO_APP_LAUNCH_UNIQUE_MONTHLY = 'studio-app-launch-uniqs-mon',
	STUDIO_SITE_CREATE = 'studio-app-site-create',
	STUDIO_IMPORT = 'studio-app-import',
	STUDIO_EXPORT = 'studio-app-export',
	// Studio CLI
	STUDIO_CLI_USAGE_UNIQUE = 'studio-cli-usage-unique',
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
	UNKNOWN_PLATFORM = 'unknown-platform',
	// Importer types
	JETPACK_IMPORTER = 'JetpackImporter',
	LOCAL_IMPORTER = 'LocalImporter',
	SQL_IMPORTER = 'SQLImporter',
	PLAYGROUND_IMPORTER = 'PlaygroundImporter',
	WPRESS_IMPORTER = 'WpressImporter',
	UNKNOWN_IMPORTER = 'UnknownImporter',
	// Site creation
	REMOTE_BLUEPRINT = 'remote-blueprint',
	FILE_BLUEPRINT = 'file-blueprint',
	NO_BLUEPRINT = 'no-blueprint',
}

export type AggregateInterval = 'daily' | 'weekly' | 'monthly';
