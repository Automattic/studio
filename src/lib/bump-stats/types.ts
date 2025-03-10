import {
	JetpackImporter,
	LocalImporter,
	PlaygroundImporter,
	SQLImporter,
	WpressImporter,
} from 'src/lib/import-export/import/importers';

export enum StatsGroup {
	STUDIO_APP_LAUNCH = 'studio-app-launch-first',
	STUDIO_APP_LAUNCH_TOTAL = 'studio-app-launch-total',
	STUDIO_APP_LAUNCH_UNIQUE = 'local-environment-launch-uniques',
	STUDIO_IMPORT = 'studio-app-import',
	STUDIO_EXPORT = 'studio-app-export',
	STUDIO_SITE_VERSIONS = 'studio-site-versions',
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
	// WordPress and PHP versions
	WP_VERSION_PREFIX = 'wp-version-',
	PHP_VERSION_PREFIX = 'php-version-',
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
			return StatsMetric.UNKNOWN_PLATFORM;
	}
}

export function getImporterMetric( importer?: string ): StatsMetric {
	switch ( importer ) {
		case JetpackImporter.name:
			return StatsMetric.JETPACK_IMPORTER;
		case LocalImporter.name:
			return StatsMetric.LOCAL_IMPORTER;
		case SQLImporter.name:
			return StatsMetric.SQL_IMPORTER;
		case PlaygroundImporter.name:
			return StatsMetric.PLAYGROUND_IMPORTER;
		case WpressImporter.name:
			return StatsMetric.WPRESS_IMPORTER;
		default:
			return StatsMetric.UNKNOWN_IMPORTER;
	}
}

export function getWordPressVersionMetric( version: string ): StatsMetric {
	const sanitizedVersion = version.replace( /\./g, '-' ).toLowerCase();
	return `${ StatsMetric.WP_VERSION_PREFIX }${ sanitizedVersion }` as unknown as StatsMetric;
}

export function getPHPVersionMetric( version: string ): StatsMetric {
	const sanitizedVersion = version.replace( /\./g, '-' ).toLowerCase();
	return `${ StatsMetric.PHP_VERSION_PREFIX }${ sanitizedVersion }` as unknown as StatsMetric;
}
