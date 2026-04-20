import {
	__bumpAggregatedUniqueStat,
	__bumpStat,
	LastBumpStatsProvider,
	AggregateInterval,
} from '@studio/common/lib/bump-stat';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { ImporterType } from '@studio/common/lib/import-export-events';

export enum StatsGroup {
	STUDIO_APP_LAUNCH = 'studio-app-launch-first',
	STUDIO_APP_LAUNCH_TOTAL = 'studio-app-launch-total',
	STUDIO_APP_LAUNCH_UNIQUE = 'studio-app-launch-uniques',
	STUDIO_APP_LAUNCH_UNIQUE_MONTHLY = 'studio-app-launch-uniqs-mon',
	STUDIO_SITE_CREATE = 'studio-app-site-create',
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

const lastBumpStatsProvider: LastBumpStatsProvider = {
	load: async () => {
		const { lastBumpStats } = await loadUserData();
		return lastBumpStats ?? {};
	},
	lock: lockAppdata,
	unlock: unlockAppdata,
	save: async ( lastBumpStats ) => {
		const userData = await loadUserData();
		userData.lastBumpStats = lastBumpStats;
		// Locking is handled in `@studio/common/lib/bump-stat`
		// eslint-disable-next-line studio/require-lock-before-save
		await saveUserData( userData );
	},
};

export function bumpStat( group: StatsGroup, stat: StatsMetric, bumpInDev = false ) {
	return __bumpStat( group, stat, bumpInDev );
}

export async function bumpAggregatedUniqueStat(
	group: StatsGroup,
	stat: StatsMetric,
	aggregateBy: AggregateInterval,
	bumpInDev = false
) {
	return __bumpAggregatedUniqueStat( group, stat, aggregateBy, lastBumpStatsProvider, bumpInDev );
}

export function getPlatformMetric(): StatsMetric {
	switch ( process.platform ) {
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

export function getImporterMetric( importer?: ImporterType ): StatsMetric {
	switch ( importer ) {
		case 'jetpack':
			return StatsMetric.JETPACK_IMPORTER;
		case 'local':
			return StatsMetric.LOCAL_IMPORTER;
		case 'sql':
			return StatsMetric.SQL_IMPORTER;
		case 'playground':
			return StatsMetric.PLAYGROUND_IMPORTER;
		case 'wpress':
			return StatsMetric.WPRESS_IMPORTER;
		default:
			return StatsMetric.UNKNOWN_IMPORTER;
	}
}

export function getBlueprintMetric( blueprintSlug: string | undefined ) {
	if ( ! blueprintSlug ) {
		return StatsMetric.NO_BLUEPRINT;
	}
	if ( blueprintSlug?.startsWith( 'file:' ) ) {
		return StatsMetric.FILE_BLUEPRINT;
	}
	return StatsMetric.REMOTE_BLUEPRINT;
}
