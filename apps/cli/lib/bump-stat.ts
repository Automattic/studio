import {
	__bumpAggregatedUniqueStat,
	__bumpStat,
	AggregateInterval,
} from '@studio/common/lib/bump-stat';
import { StatsGroup, StatsMetric } from 'cli/lib/types/bump-stats';
import { getCliInstallKind } from 'cli/lib/update-notifier';

export function bumpStat( group: StatsGroup, stat: StatsMetric, bumpInDev = false ) {
	return __bumpStat( group, stat, bumpInDev );
}

export async function bumpAggregatedUniqueStat(
	group: StatsGroup,
	stat: StatsMetric,
	aggregateBy: AggregateInterval,
	bumpInDev = false
) {
	return __bumpAggregatedUniqueStat( group, stat, aggregateBy, bumpInDev );
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

type InstallTypeLaunchStatGroups = {
	weeklyUnique: StatsGroup;
	monthlyUnique: StatsGroup;
	firstLaunch: StatsGroup;
	totalLaunches: StatsGroup;
};

export function getInstallTypeLaunchStatGroups(): InstallTypeLaunchStatGroups {
	const installKind = getCliInstallKind();

	if ( installKind === 'npm' ) {
		return {
			weeklyUnique: StatsGroup.STUDIO_CLI_WEEKLY_UNIQUE_NPM,
			monthlyUnique: StatsGroup.STUDIO_CLI_MONTHLY_UNIQUE_NPM,
			firstLaunch: StatsGroup.STUDIO_CLI_FIRST_LAUNCH_NPM,
			totalLaunches: StatsGroup.STUDIO_CLI_TOTAL_LAUNCHES_NPM,
		};
	}

	if ( installKind === 'standalone' ) {
		return {
			weeklyUnique: StatsGroup.STUDIO_CLI_WEEKLY_UNIQUE_STANDALONE,
			monthlyUnique: StatsGroup.STUDIO_CLI_MONTHLY_UNIQUE_STANDALONE,
			firstLaunch: StatsGroup.STUDIO_CLI_FIRST_LAUNCH_STANDALONE,
			totalLaunches: StatsGroup.STUDIO_CLI_TOTAL_LAUNCHES_STANDALONE,
		};
	}

	// Desktop-embedded CLI (and dev builds) bucket under the "app" groups.
	return {
		weeklyUnique: StatsGroup.STUDIO_CLI_WEEKLY_UNIQUE_APP,
		monthlyUnique: StatsGroup.STUDIO_CLI_MONTHLY_UNIQUE_APP,
		firstLaunch: StatsGroup.STUDIO_CLI_FIRST_LAUNCH_APP,
		totalLaunches: StatsGroup.STUDIO_CLI_TOTAL_LAUNCHES_APP,
	};
}
