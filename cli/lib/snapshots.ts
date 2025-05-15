import { __, sprintf } from '@wordpress/i18n';
// eslint-disable-next-line import/no-named-as-default
import Table from 'cli-table3';
import { HOUR_MS, DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from 'common/constants';
import { Snapshot } from 'common/types/snapshot';
import {
	addDays,
	addHours,
	DurationUnit,
	format,
	formatDuration,
	intervalToDuration,
} from 'date-fns';
import {
	getAuthToken,
	getSiteByFolder,
	readAppdata,
	getOrCreateSiteByFolder,
	withAppdataWrite,
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

export const updateSnapshotInAppdata = withAppdataWrite( async function* (
	userData,
	atomicSiteId: number,
	siteFolder: string
) {
	const site = await getOrCreateSiteByFolder( siteFolder );
	const snapshot = userData.snapshots.find( ( s ) => s.atomicSiteId === atomicSiteId );
	if ( ! snapshot ) {
		throw new LoggerError( __( 'Failed to find existing preview site in appdata' ) );
	}

	snapshot.localSiteId = site.id;
	snapshot.date = Date.now();
	yield userData;

	return snapshot;
} );

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

export const saveSnapshotToAppdata = withAppdataWrite( async function* (
	userData,
	siteFolder: string,
	atomicSiteId: number,
	previewUrl: string
) {
	const site = await getOrCreateSiteByFolder( siteFolder );
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
	yield userData;
	return snapshot;
} );

export const deleteSnapshotFromAppdata = withAppdataWrite( function* (
	userData,
	snapshotUrl: string
) {
	const snapshotIndex = userData.snapshots.findIndex( ( s ) => s.url === snapshotUrl );
	if ( snapshotIndex === -1 ) {
		return;
	}
	userData.snapshots.splice( snapshotIndex, 1 );
	yield userData;
} );

export function isSnapshotExpired( snapshot: Snapshot ) {
	const now = new Date();
	const endDate = addDays( snapshot.date, DEMO_SITE_EXPIRATION_DAYS );
	return endDate < now;
}

function formatDurationUntilExpiry( lastUpdatedAt: number ) {
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

function getColumnWidths( widthFactors: number[] ) {
	const padding = widthFactors.length * 2;
	const columns = Math.min( process.stdout.columns || 80, 140 ) - padding;
	return widthFactors.map( ( widthFactor ) => Math.round( widthFactor * columns ) );
}

export function getSnapshotCliTable( snapshots: Snapshot[] ) {
	const colWidths = getColumnWidths( [ 0.4, 0.25, 0.175, 0.175 ] );
	const table = new Table( {
		head: [ __( 'URL' ), __( 'Site Name' ), __( 'Updated' ), __( 'Expires in' ) ],
		wordWrap: true,
		wrapOnWordBoundary: false,
		colWidths,
		style: {
			head: [],
			border: [],
		},
	} );

	snapshots.forEach( ( snapshot ) => {
		const durationUntilExpiry = formatDurationUntilExpiry( snapshot.date );
		const url = `https://${ snapshot.url }`;

		table.push( [
			{ href: url, content: url },
			snapshot.name,
			format( snapshot.date, 'yyyy-MM-dd HH:mm' ),
			durationUntilExpiry,
		] );
	} );

	return table;
}

export function getSnapshotCliJson( snapshots: Snapshot[] ) {
	return snapshots.map( ( snapshot ) => ( {
		url: `https://${ snapshot.url }`,
		name: snapshot.name,
		date: format( snapshot.date, 'yyyy-MM-dd HH:mm' ),
		expiresIn: formatDurationUntilExpiry( snapshot.date ),
	} ) );
}
