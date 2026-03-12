import {
	__bumpAggregatedUniqueStat,
	__bumpStat,
	AggregateInterval,
	LastBumpStatsProvider,
} from '@studio/common/lib/bump-stat';
import { lockAppdata, readAppdata, saveAppdata, unlockAppdata } from 'cli/lib/appdata';

export enum StatsGroup {
	STUDIO_CLI_USAGE_UNIQUE = 'studio-cli-usage-unique',
	STUDIO_CLI_WEEKLY_UNIQUE_NPM = 'studio-cli-weekly-unq-npm',
	STUDIO_CLI_WEEKLY_UNIQUE_APP = 'studio-cli-weekly-unq-app',
}

export enum StatsMetric {
	SUCCESS = 'success',
	FAILURE = 'failure',
	// Platforms
	DARWIN = 'darwin',
	LINUX = 'linux',
	WINDOWS = 'win32',
	UNKNOWN_PLATFORM = 'unknown-platform',
}

const lastBumpStatsProvider: LastBumpStatsProvider = {
	load: async () => {
		const { lastBumpStats } = await readAppdata();
		return lastBumpStats ?? {};
	},
	lock: lockAppdata,
	unlock: unlockAppdata,
	save: async ( lastBumpStats ) => {
		const appdata = await readAppdata();
		appdata.lastBumpStats = lastBumpStats;
		// Locking is handled in `@studio/common/lib/bump-stat`
		// eslint-disable-next-line studio/require-lock-before-save
		await saveAppdata( appdata );
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
