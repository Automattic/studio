import * as Sentry from '@sentry/electron/main';
import { isSameDay, isSameMonth, isSameWeek } from 'date-fns';
import { AggregateInterval, StatsGroup, StatsMetric } from 'common/types/stats';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';

// Bumps a stat if it hasn't been bumped within the current aggregate interval.
// This allows us to approximate a 1-count-per-user stat without recording which
// user the event came from (bump stats are anonymous).
//
// We don't want to block the thread to record the stat, so this function doesn't
// await promises before returning.
export function bumpAggregatedUniqueStat(
	group: StatsGroup,
	stat: StatsMetric,
	aggregateBy: AggregateInterval,
	bumpInDev = false
) {
	getLastBump( group, stat )
		.then( ( lastBump ) => {
			if ( lastBump === null ) {
				// Bump the stat the first time it's seen
				bumpStat( group, stat, bumpInDev );
				return true;
			}

			const now = Date.now();

			if ( aggregateBy === 'daily' && isSameDay( lastBump, now ) ) {
				return false;
			}
			if ( aggregateBy === 'weekly' && isSameWeek( lastBump, now ) ) {
				return false;
			}
			if ( aggregateBy === 'monthly' && isSameMonth( lastBump, now ) ) {
				return false;
			}

			// Bump the stat for subsequent occurrences within the time interval
			return bumpStat( group, stat, bumpInDev );
		} )
		.then( ( didBump ) => {
			if ( didBump ) {
				void updateLastBump( group, stat );
			}
		} )
		.catch( ( err ) => Sentry.captureException( err ) );
}

// Returns true if we attempted to bump the stat
export function bumpStat( group: StatsGroup, stat: StatsMetric, bumpInDev = false ) {
	if ( process.env.E2E || ( process.env.NODE_ENV === 'development' && ! bumpInDev ) ) {
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
async function getLastBump( group: string, stat: string ): Promise< number | null > {
	const { lastBumpStats } = await loadUserData();
	return lastBumpStats?.[ group ]?.[ stat ] ?? null;
}

// Store this moment as the last time we bumped the state, in UTC time.
async function updateLastBump( group: string, stat: string ) {
	try {
		await lockAppdata();
		const data = await loadUserData();
		data.lastBumpStats ??= {};
		data.lastBumpStats[ group ] ??= {};
		data.lastBumpStats[ group ][ stat ] = Date.now();
		await saveUserData( data );
	} finally {
		await unlockAppdata();
	}
}
