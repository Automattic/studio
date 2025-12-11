import { StatsGroup, StatsMetric } from 'common/types/stats';

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
