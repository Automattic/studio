import { isSameDay, isSameMonth, isSameWeek } from 'date-fns';
import { AggregateInterval, StatsGroup, StatsMetric } from '@studio/common/types/stats';

// Database columns are varchar(32). Group limit is 27 to account for the '-a11n' suffix
// added by the backend for Automattic requests (27 + 5 = 32).
const MAX_GROUP_LENGTH = 27;
const MAX_STAT_LENGTH = 32;

// Returns true if we attempted to bump the stat
export function bumpStat( group: StatsGroup, stat: StatsMetric, bumpInDev = false ) {
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
export interface LastBumpStatsData {
	lastBumpStats?: Record< string, Record< string, number > >;
}

// Appdata provider interface for abstracting storage operations
export interface AppdataProvider< T extends LastBumpStatsData > {
	load: () => Promise< T >;
	lock: () => Promise< void >;
	unlock: () => Promise< void >;
	save: ( data: T ) => Promise< void >;
}

// Bumps a stat if it hasn't been bumped within the current aggregate interval.
// This allows us to approximate a 1-count-per-user stat without recording which
// user the event came from (bump stats are anonymous).
//
// NOTE: Error handling (e.g., Sentry) should be done by the consumer.
export async function bumpAggregatedUniqueStat< T extends LastBumpStatsData >(
	group: StatsGroup,
	stat: StatsMetric,
	aggregateBy: AggregateInterval,
	appdataProvider: AppdataProvider< T >,
	bumpInDev = false
) {
	const lastBump = await getLastBump( group, stat, appdataProvider );

	if ( lastBump === null ) {
		bumpStat( group, stat, bumpInDev );
		await updateLastBump( group, stat, appdataProvider );
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
		await updateLastBump( group, stat, appdataProvider );
	}
}

// Returns UTC timestamp of the last time the stat was bumped, or null if it has never been bumped.
async function getLastBump< T extends LastBumpStatsData >(
	group: StatsGroup,
	stat: StatsMetric,
	appdataProvider: AppdataProvider< T >
): Promise< number | null > {
	const { lastBumpStats } = await appdataProvider.load();
	return lastBumpStats?.[ group ]?.[ stat ] ?? null;
}

// Store this moment as the last time we bumped the state, in UTC time.
async function updateLastBump< T extends LastBumpStatsData >(
	group: StatsGroup,
	stat: StatsMetric,
	appdataProvider: AppdataProvider< T >
) {
	try {
		await appdataProvider.lock();
		const userData = await appdataProvider.load();
		userData.lastBumpStats ??= {};
		userData.lastBumpStats[ group ] ??= {};
		( userData.lastBumpStats[ group ] as Record< StatsMetric, number > )[ stat ] = Date.now();
		await appdataProvider.save( userData );
	} finally {
		await appdataProvider.unlock();
	}
}
