import { isSameDay, isSameMonth, isSameWeek } from 'date-fns';
import fetch from 'node-fetch';
import { AggregateInterval, StatsGroup, StatsMetric } from 'src/lib/bump-stats/types';
import { readAppdata, saveAppdata } from './appdata';

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
		const didBump = bumpStat( group, stat, bumpInDev );
		if ( didBump ) {
			await updateLastBump( group, stat );
		}
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

// Returns true if we attempted to bump the stat
export function bumpStat( group: StatsGroup, stat: StatsMetric, bumpInDev = false ) {
	if ( process.env.NODE_ENV === 'development' && ! bumpInDev ) {
		console.info( `Would have bumped stat: ${ group }=${ stat }` );
		return false;
	}

	// Fire and forget POST request
	fetch( 'https://public-api.wordpress.com/wpcom/v2/studio-app/bump-stat', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify( { group, stat } ),
	} ).catch( () => {
		// A failed request typically indicates a network issue, which we don't need to report
	} );

	return true;
}

// Returns UTC timestamp of the last time the stat was bumped, or null if it has never been bumped.
async function getLastBump( group: StatsGroup, stat: StatsMetric ): Promise< number | null > {
	const { lastBumpStats } = await readAppdata();
	return lastBumpStats?.[ group ]?.[ stat ] ?? null;
}

// Store this moment as the last time we bumped the state, in UTC time.
async function updateLastBump( group: StatsGroup, stat: StatsMetric ) {
	const data = await readAppdata();
	data.lastBumpStats ??= {};
	data.lastBumpStats[ group ] ??= {};
	( data.lastBumpStats[ group ] as Record< StatsMetric, number > )[ stat ] = Date.now();
	await saveAppdata( data );
}
