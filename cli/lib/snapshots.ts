import { __, sprintf } from '@wordpress/i18n';
import { HOUR_MS, DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from 'common/constants';
import { Snapshot } from 'common/types/snapshot';
import { addDays, addHours, DurationUnit, formatDuration, intervalToDuration } from 'date-fns';
import {
	getAuthToken,
	getSiteByFolder,
	readAppdata,
	lockAppdata,
	unlockAppdata,
	saveAppdata,
} from 'cli/lib/appdata';
import { LoggerError } from 'cli/logger';

export async function getSnapshotsFromAppdata(
	userId: number,
	siteFolder?: string
): Promise< Snapshot[] > {
	const userData = await readAppdata();
	let snapshots = userData.snapshots;
	snapshots = snapshots.filter( ( snapshot ) => snapshot.userId === userId );

	if ( siteFolder ) {
		const site = await getSiteByFolder( siteFolder );
		snapshots = snapshots.filter( ( snapshot ) => snapshot.localSiteId === site.id );
	}

	return snapshots;
}

export async function updateSnapshotInAppdata(
	atomicSiteId: number,
	siteFolder: string
): Promise< Snapshot > {
	try {
		const site = await getSiteByFolder( siteFolder );
		await lockAppdata();
		const userData = await readAppdata();
		const snapshot = userData.snapshots.find( ( s ) => s.atomicSiteId === atomicSiteId );
		if ( ! snapshot ) {
			throw new LoggerError( __( 'Failed to find existing preview site in appdata' ) );
		}

		snapshot.localSiteId = site.id;
		snapshot.date = Date.now();

		await saveAppdata( userData );
		return snapshot;
	} finally {
		await unlockAppdata();
	}
}

const getNextSequenceNumber = ( siteId: string, snapshots: Snapshot[], userId: number ): number => {
	const siteSnapshots = snapshots.filter(
		( s ) => s.localSiteId === siteId && s.userId === userId
	);

	const existingSequences = siteSnapshots
		.map( ( s ) => s.sequence ?? 0 )
		.filter( ( n ) => ! isNaN( n ) );

	return existingSequences.length > 0
		? Math.max( ...existingSequences ) + 1
		: siteSnapshots.length + 1;
};

export async function saveSnapshotToAppdata(
	siteFolder: string,
	atomicSiteId: number,
	previewUrl: string
): Promise< Snapshot > {
	try {
		const site = await getSiteByFolder( siteFolder );
		await lockAppdata();
		const userData = await readAppdata();
		const authToken = await getAuthToken();

		const nextSequenceNumber = getNextSequenceNumber( site.id, userData.snapshots, authToken.id );
		const snapshot: Snapshot = {
			url: previewUrl,
			atomicSiteId,
			localSiteId: site.id,
			date: Date.now(),
			name: sprintf(
				/* translators: 1: Site name 2: Sequence number (e.g. "My Site Name Preview 1") */
				__( '%1$s Preview %2$d' ),
				site.name,
				nextSequenceNumber
			),
			sequence: nextSequenceNumber,
			userId: authToken.id,
		};

		userData.snapshots.push( snapshot );
		await saveAppdata( userData );
		return snapshot;
	} finally {
		await unlockAppdata();
	}
}

export async function deleteSnapshotFromAppdata( snapshotUrl: string ) {
	try {
		await lockAppdata();
		const userData = await readAppdata();
		const snapshotIndex = userData.snapshots.findIndex( ( s ) => s.url === snapshotUrl );
		if ( snapshotIndex === -1 ) {
			return;
		}
		userData.snapshots.splice( snapshotIndex, 1 );
		await saveAppdata( userData );
	} finally {
		await unlockAppdata();
	}
}

export function isSnapshotExpired( snapshot: Snapshot ) {
	const now = new Date();
	const endDate = addDays( snapshot.date, DEMO_SITE_EXPIRATION_DAYS );
	return endDate < now;
}

export function formatDurationUntilExpiry( lastUpdatedAt: number ) {
	const now = new Date();
	const endDate = addDays( lastUpdatedAt, DEMO_SITE_EXPIRATION_DAYS );
	const difference = endDate.getTime() - now.getTime();
	let format: DurationUnit[] = [ 'days', 'hours' ];

	if ( difference < HOUR_MS ) {
		format = [ 'minutes' ];
	} else if ( difference < DAY_MS ) {
		format = [ 'hours', 'minutes' ];
	}

	if ( endDate < now ) {
		return __( 'Expired' );
	}

	return formatDuration(
		intervalToDuration( {
			start: now,
			end: addHours( endDate, 1 ),
		} ),
		{
			format,
			delimiter: ', ',
		}
	);
}
