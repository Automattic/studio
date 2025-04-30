import path from 'node:path';
import { promisify } from 'node:util';
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
import lockfile from 'lockfile';
import {
	getAppdataDirectory,
	getAuthToken,
	getNewSitePartial,
	getSiteByFolder,
	readAppdata,
	saveAppdata,
} from 'cli/lib/appdata';
import { LoggerError } from 'cli/logger';

const UPDATE_SNAPSHOTS_LOCKFILE_PATH = path.join(
	getAppdataDirectory(),
	'studio-update-snapshots.lock'
);

function lock( path: string, options: lockfile.Options ) {
	return new Promise< void >( ( resolve, reject ) => {
		lockfile.lock( path, options, ( err ) => {
			if ( err ) {
				reject( err );
			} else {
				resolve();
			}
		} );
	} );
}

const unlock = promisify( lockfile.unlock );

export async function getSnapshotsFromAppdata(
	userId: number,
	siteFolder?: string
): Promise< Snapshot[] > {
	const userData = await readAppdata();
	let snapshots = userData.snapshots ?? [];
	snapshots = snapshots.filter( ( snapshot ) => snapshot.userId === userId );

	if ( siteFolder ) {
		const site = await getSiteByFolder( siteFolder );
		snapshots = snapshots.filter( ( snapshot ) => snapshot.localSiteId === site.id );
	}

	return snapshots;
}

export async function updateSnapshotDateInAppdata( atomicSiteId: number ): Promise< Snapshot > {
	const userData = await readAppdata();
	if ( ! userData.snapshots ) {
		userData.snapshots = [];
	}

	const snapshot = userData.snapshots.find( ( s ) => s.atomicSiteId === atomicSiteId );
	if ( ! snapshot ) {
		throw new LoggerError( __( 'Failed to find existing preview site in appdata' ) );
	}

	snapshot.date = Date.now();
	await saveAppdata( userData );

	return snapshot;
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
	const userData = await readAppdata();
	const authToken = await getAuthToken();
	let site;
	try {
		site = await getSiteByFolder( siteFolder );
	} catch ( error ) {
		if ( ! ( error instanceof LoggerError ) ) {
			throw error;
		}
		site = getNewSitePartial( siteFolder );
		if ( ! userData.newSites ) {
			userData.newSites = [];
		}
		userData.newSites.push( site );
	}

	if ( ! userData.snapshots ) {
		userData.snapshots = [];
	}

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
}

export async function deleteSnapshotFromAppdata( snapshotUrl: string ): Promise< void > {
	await lock( UPDATE_SNAPSHOTS_LOCKFILE_PATH, { wait: 1000 } );
	const userData = await readAppdata();
	if ( ! userData.snapshots ) {
		return;
	}
	const snapshotIndex = userData.snapshots.findIndex( ( s ) => s.url === snapshotUrl );
	if ( snapshotIndex === -1 ) {
		return;
	}
	userData.snapshots.splice( snapshotIndex, 1 );
	await saveAppdata( userData );
	await unlock( UPDATE_SNAPSHOTS_LOCKFILE_PATH );
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
