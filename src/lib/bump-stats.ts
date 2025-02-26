import * as Sentry from '@sentry/electron/main';
import { isSameDay, isSameMonth, isSameWeek } from 'date-fns';
import fetch from 'node-fetch';
import { BackupArchiveInfo } from 'src/lib/import-export/import/types';
import { loadUserData, saveUserData } from 'src/storage/user-data';

export const STATS_GROUP = {
	STUDIO_APP_LAUNCH: 'studio-app-launch-first',
	STUDIO_APP_LAUNCH_TOTAL: 'studio-app-launch-total',
	STUDIO_APP_LAUNCH_UNIQUE: 'local-environment-launch-uniques',
	STUDIO_IMPORT: 'studio-app-import',
	STUDIO_EXPORT: 'studio-app-export',
	STUDIO_IMPORT_TYPE: 'studio-app-import-type',
	STUDIO_EXPORT_CONTENT: 'studio-app-export-content',
} as const;

export const STATS_METRIC = {
	SUCCESS: 'success',
	FAILURE: 'failure',
	// Export content types
	DATABASE: 'database',
	UPLOADS: 'uploads',
	PLUGINS: 'plugins',
	THEMES: 'themes',
	MU_PLUGINS: 'mu-plugins',
} as const;

export type AggregateInterval = 'daily' | 'weekly' | 'monthly';

type StatsGroup = ( typeof STATS_GROUP )[ keyof typeof STATS_GROUP ];
type StatsMetric =
	| ( typeof STATS_METRIC )[ keyof typeof STATS_METRIC ]
	| typeof process.platform
	| BackupArchiveInfo[ 'type' ];

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
				updateLastBump( group, stat );
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
	const data = await loadUserData();
	data.lastBumpStats ??= {};
	data.lastBumpStats[ group ] ??= {};
	data.lastBumpStats[ group ][ stat ] = Date.now();
	await saveUserData( data );
}
