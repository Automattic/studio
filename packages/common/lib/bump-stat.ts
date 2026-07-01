import { isSameDay, isSameMonth, isSameWeek } from 'date-fns';

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

// Base type for user data that can track bump stats
export type LastBumpStats = Record< string, Record< string, number > >;

// Appdata provider interface for abstracting storage operations
export interface LastBumpStatsProvider {
	load: () => Promise< LastBumpStats >;
	lock: () => Promise< void >;
	unlock: () => Promise< void >;
	save: ( lastBumpStats: LastBumpStats ) => Promise< void >;
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
	provider: LastBumpStatsProvider,
	bumpInDev = false
) {
	const lastBump = await getLastBump( group, stat, provider );

	if ( lastBump === null ) {
		__bumpStat( group, stat, bumpInDev );
		await updateLastBump( group, stat, provider );
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
		await updateLastBump( group, stat, provider );
	}
}

// Returns UTC timestamp of the last time the stat was bumped, or null if it has never been bumped.
async function getLastBump(
	group: string,
	stat: string,
	provider: LastBumpStatsProvider
): Promise< number | null > {
	const lastBumpStats = await provider.load();
	return lastBumpStats?.[ group ]?.[ stat ] ?? null;
}

// Store this moment as the last time we bumped the state, in UTC time.
async function updateLastBump( group: string, stat: string, provider: LastBumpStatsProvider ) {
	try {
		await provider.lock();
		const lastBumpStats = await provider.load();
		lastBumpStats[ group ] ??= {};
		lastBumpStats[ group ][ stat ] = Date.now();
		await provider.save( lastBumpStats );
	} finally {
		await provider.unlock();
	}
}
