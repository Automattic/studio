import https from 'https';
import * as Sentry from '@sentry/electron/main';
import { isSameDay, isSameMonth, isSameWeek } from 'date-fns';
import { loadUserData, saveUserData } from '../storage/user-data';

export type AggregateInterval = 'daily' | 'weekly' | 'monthly';

// Bumps a stat if it hasn't been bumped within the current aggregate interval.
// This allows us to approximate a 1-count-per-user stat without recording which
// user the event came from (bump stats are anonymous).
//
// We don't want to block the thread to record the stat, so this function doesn't
// await promises before returning.
export function bumpAggregatedUniqueStat(
	group: string,
	stat: string,
	aggregateBy: AggregateInterval,
	bumpInDev = false
) {
	getLastBump( group, stat )
		.then( ( lastBump ) => {
			if ( lastBump === null ) {
				// Bump the stat the first time it's seen
				bumpStat( group, stat, bumpInDev );
				// Also, explicitly track the first occurrence by appending `-first`
				bumpStat( `${ group }-first`, stat, bumpInDev );
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
				updateLastBump( group, stat );
			}
		} )
		.catch( ( err ) => Sentry.captureException( err ) );
}

// Returns true if we attempted to bump the stat
export function bumpStat( group: string, stat: string, bumpInDev = false ) {
	if ( process.env.E2E || ( process.env.NODE_ENV === 'development' && ! bumpInDev ) ) {
		console.info( `Would have bumped stat: ${ group }=${ stat }` );
		return false;
	}

	const url = new URL( 'https://pixel.wp.com/b.gif?v=wpcom-no-pv' );
	url.searchParams.append( `x_${ group }`, stat );

	// Fire and forget GET request
	https.get( url.toString() );
	return true;
}

// Returns UTC timestamp of the last time the stat was bumped, or null if it has never been bumped.
async function getLastBump( group: string, stat: string ): Promise< number | null > {
	const { lastBumpStats } = await loadUserData();
	return lastBumpStats?.[ group ]?.[ stat ] ?? null;
}

// Store this moment as the last time we bumped the state, in UTC time.
async function updateLastBump( group: string, stat: string ) {
	const data = await loadUserData();
	data.lastBumpStats ??= {};
	data.lastBumpStats[ group ] ??= {};
	data.lastBumpStats[ group ][ stat ] = Date.now();
	await saveUserData( data );
}
