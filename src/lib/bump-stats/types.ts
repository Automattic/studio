import { BackupArchiveInfo } from 'src/lib/import-export/import/types';

export const STATS_GROUP = {
	STUDIO_APP_LAUNCH: 'studio-app-launch-first',
	STUDIO_APP_LAUNCH_TOTAL: 'studio-app-launch-total',
	STUDIO_APP_LAUNCH_UNIQUE: 'local-environment-launch-uniques',
	STUDIO_IMPORT: 'studio-app-import',
	STUDIO_EXPORT: 'studio-app-export',
} as const;

export const STATS_METRIC = {
	SUCCESS: 'success',
	FAILURE: 'failure',
	// Export content types
	DATABASE: 'database',
	UPLOADS: 'uploads',
	PLUGINS: 'plugins',
	THEMES: 'themes',
	MU_PLUGINS: 'mu-plugins',
	// Export button types
	FULL_SITE: 'full-site',
	DATABASE_ONLY: 'database-only',
} as const;

export type AggregateInterval = 'daily' | 'weekly' | 'monthly';

export type StatsGroup = ( typeof STATS_GROUP )[ keyof typeof STATS_GROUP ];
export type StatsMetric =
	| ( typeof STATS_METRIC )[ keyof typeof STATS_METRIC ]
	| typeof process.platform
	| BackupArchiveInfo[ 'type' ];
