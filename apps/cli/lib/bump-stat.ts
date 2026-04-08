import {
	__bumpAggregatedUniqueStat,
	__bumpStat,
	AggregateInterval,
	LastBumpStatsProvider,
} from '@studio/common/lib/bump-stat';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { StatsGroup, StatsMetric } from 'cli/lib/types/bump-stats';

const lastBumpStatsProvider: LastBumpStatsProvider = {
	load: async () => {
		const { lastBumpStats } = await readCliConfig();
		return lastBumpStats ?? {};
	},
	lock: lockCliConfig,
	unlock: unlockCliConfig,
	save: async ( lastBumpStats ) => {
		const config = await readCliConfig();
		config.lastBumpStats = lastBumpStats;
		// Locking is handled in `@studio/common/lib/bump-stat`
		// eslint-disable-next-line studio/require-lock-before-save
		await saveCliConfig( config );
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
