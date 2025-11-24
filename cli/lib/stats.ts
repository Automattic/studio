import { bumpStat } from 'common/lib/bump-stat';
import { AggregateInterval, StatsGroup, StatsMetric } from 'common/types/stats';
import { isSameDay, isSameMonth, isSameWeek } from 'date-fns';
import { lockAppdata, readAppdata, saveAppdata, unlockAppdata } from 'cli/lib/appdata';

// Bumps a stat if it hasn't been bumped within the current aggregate interval.
// This allows us to approximate a 1-count-per-user stat without recording which
// user the event came from (bump stats are anonymous).
//
// We don't want to block the thread to record the stat, so this function doesn't
// await promises before returning.
export async function bumpAggregatedUniqueStat(
	group: StatsGroup,
	stat: StatsMetric,
	aggregateBy: AggregateInterval,
	bumpInDev = false
) {
	const lastBump = await getLastBump( group, stat );

	if ( lastBump === null ) {
		bumpStat( group, stat, bumpInDev );
		await updateLastBump( group, stat );
		return;
	}

	const now = Date.now();

	if ( aggregateBy === 'daily' && isSameDay( lastBump, now ) ) {
		return;
	}
	if ( aggregateBy === 'weekly' && isSameWeek( lastBump, now ) ) {
		return;
	}
	if ( aggregateBy === 'monthly' && isSameMonth( lastBump, now ) ) {
		return;
	}

	const didBump = bumpStat( group, stat, bumpInDev );
	if ( didBump ) {
		await updateLastBump( group, stat );
	}
}

export { bumpStat } from 'common/lib/bump-stat';

// Returns UTC timestamp of the last time the stat was bumped, or null if it has never been bumped.
async function getLastBump( group: StatsGroup, stat: StatsMetric ): Promise< number | null > {
	const { lastBumpStats } = await readAppdata();
	return lastBumpStats?.[ group ]?.[ stat ] ?? null;
}

// Store this moment as the last time we bumped the state, in UTC time.
async function updateLastBump( group: StatsGroup, stat: StatsMetric ) {
	try {
		await lockAppdata();
		const userData = await readAppdata();
		userData.lastBumpStats ??= {};
		userData.lastBumpStats[ group ] ??= {};
		( userData.lastBumpStats[ group ] as Record< StatsMetric, number > )[ stat ] = Date.now();
		await saveAppdata( userData );
	} finally {
		await unlockAppdata();
	}
}
