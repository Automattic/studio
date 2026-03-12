import {
	__bumpAggregatedUniqueStat,
	__bumpStat,
	ConfigFileProvider,
	AggregateInterval,
} from '@studio/common/lib/bump-stat';
import {
	JetpackImporter,
	LocalImporter,
	PlaygroundImporter,
	SQLImporter,
	WpressImporter,
} from 'src/lib/import-export/import/importers';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';

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

const appdataProvider: ConfigFileProvider = {
	load: async () => {
		const { lastBumpStats } = await loadUserData();
		return lastBumpStats ?? {};
	},
	save: async ( lastBumpStats ) => {
		try {
			await lockAppdata();
			const userData = await loadUserData();
			userData.lastBumpStats = lastBumpStats;
			await saveUserData( userData );
		} finally {
			await unlockAppdata();
		}
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
	return __bumpAggregatedUniqueStat( group, stat, aggregateBy, appdataProvider, bumpInDev );
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

export function getBlueprintMetric( blueprintSlug: string | undefined ) {
	if ( ! blueprintSlug ) {
		return StatsMetric.NO_BLUEPRINT;
	}
	if ( blueprintSlug?.startsWith( 'file:' ) ) {
		return StatsMetric.FILE_BLUEPRINT;
	}
	return StatsMetric.REMOTE_BLUEPRINT;
}
