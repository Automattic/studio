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
	// Dolly remote-session in the desktop app — counterpart to the CLI Dolly stats from STU-1739.
	// The CLI stats fire on every daemon start (including app-spawned ones); these stats
	// isolate the desktop UI's contribution (beta toggle, bolt-icon clicks, app-side uniques).
	STUDIO_APP_DOLLY_ENABLE = 'studio-app-dolly-enable',
	STUDIO_APP_DOLLY_DISABLE = 'studio-app-dolly-disable',
	STUDIO_APP_DOLLY_START = 'studio-app-dolly-start',
	STUDIO_APP_DOLLY_STOP = 'studio-app-dolly-stop',
	STUDIO_APP_DOLLY_WKLY_UNQ = 'studio-app-dolly-wkly-unq',
	STUDIO_APP_DOLLY_MON_UNQ = 'studio-app-dolly-mon-unq',
	// Studio Code assistant (pi-agent) usage from the desktop UI. The CLI is
	// spawned with `--avoid-telemetry`, so these are the only stats that capture
	// the new assistant's usage.
	STUDIO_CODE_UI_SEND = 'studio-code-ui-send',
	STUDIO_CODE_UI_RUN = 'studio-code-ui-run',
	STUDIO_CODE_UI_WKLY_UNQ = 'studio-code-ui-wk-unq',
	STUDIO_CODE_UI_MON_UNQ = 'studio-code-ui-mon-unq',
	// In-app feedback submissions (success/failure) from the desktop UI.
	STUDIO_APP_FEEDBACK = 'studio-app-feedback',
}

export enum StatsMetric {
	SUCCESS = 'success',
	FAILURE = 'failure',
	INTERRUPTED = 'interrupted',
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

// Backs the desktop's aggregated weekly/monthly unique stats with app.json.
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

export function bumpStat( group: StatsGroup, stat: StatsMetric | string, bumpInDev = false ) {
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

export function getBlueprintMetric( blueprintSlug: string | undefined ): string {
	if ( ! blueprintSlug ) {
		return StatsMetric.NO_BLUEPRINT;
	}
	if ( blueprintSlug.startsWith( 'file:' ) ) {
		return StatsMetric.FILE_BLUEPRINT;
	}
	// Include the slug to differentiate individual blueprints.
	// Truncate to stay within the 32-char stat limit.
	return `bp-${ blueprintSlug }`.slice( 0, 32 );
}
