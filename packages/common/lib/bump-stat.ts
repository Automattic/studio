import { isSameDay } from 'date-fns/isSameDay';
import { isSameMonth } from 'date-fns/isSameMonth';
import { isSameWeek } from 'date-fns/isSameWeek';
import { isAutomatedRun } from './analytics-environment';
import { readConfig, updateConfig } from './config/store';

// Database columns are varchar(32). Group limit is 27 to account for the '-a11n' suffix
// added by the backend for Automattic requests (27 + 5 = 32).
const MAX_GROUP_LENGTH = 27;
const MAX_STAT_LENGTH = 32;

export type AggregateInterval = 'daily' | 'weekly' | 'monthly' | 'forever';

// Returns true if we attempted to bump the stat
export function __bumpStat( group: string, stat: string, bumpInDev = false ) {
	if ( group.length > MAX_GROUP_LENGTH ) {
		console.error(
			`Stat group "${ group }" exceeds maximum length of ${ MAX_GROUP_LENGTH } characters (actual: ${ group.length }). Stat will not be bumped.`
		);
		return false;
	}

	if ( stat.length > MAX_STAT_LENGTH ) {
		console.error(
			`Stat name "${ stat }" exceeds maximum length of ${ MAX_STAT_LENGTH } characters (actual: ${ stat.length }). Stat will not be bumped.`
		);
		return false;
	}

	if ( isAutomatedRun() || ( process.env.NODE_ENV === 'development' && ! bumpInDev ) ) {
		console.info( `Would have bumped stat: ${ group }=${ stat }` );
		return false;
	}

	// Fire and forget POST request
	fetch( 'https://public-api.wordpress.com/wpcom/v2/studio-app/bump-stat', {
		method: 'POST',
		signal: AbortSignal.timeout( 5_000 ),
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify( { group, stat } ),
	} ).catch( () => {
		// A failed request typically indicates a network issue, which we don't need to report
	} );

	return true;
}

// Bumps a stat if it hasn't been bumped within the current aggregate interval. This allows us to
// approximate a 1-count-per-user stat without recording which user the event came from (bump stats
// are anonymous).
//
// IMPORTANT: You should use the type-safe wrappers in `apps/cli` and `apps/studio` instead of
// calling this function directly.
export async function __bumpAggregatedUniqueStat(
	group: string,
	stat: string,
	aggregateBy: AggregateInterval,
	bumpInDev = false
) {
	const lastBump = ( await readConfig() ).stats.lastBump[ group ]?.[ stat ] ?? null;

	if ( lastBump === null ) {
		__bumpStat( group, stat, bumpInDev );
		await updateLastBump( group, stat );
		return;
	}

	// `forever` is suitable for stats like "first launch"
	if ( aggregateBy === 'forever' ) {
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

	const didBump = __bumpStat( group, stat, bumpInDev );
	if ( didBump ) {
		await updateLastBump( group, stat );
	}
}

// Store this moment as the last time we bumped the stat, in UTC time.
async function updateLastBump( group: string, stat: string ) {
	await updateConfig( ( { stats } ) => {
		stats.lastBump[ group ] = { ...stats.lastBump[ group ], [ stat ]: Date.now() };
	} );
}
