import { __, sprintf } from '@wordpress/i18n';
import { Snapshot } from 'common/types/snapshot';
import { getAuthToken, getSiteByFolder, readAppdata, saveAppdata } from 'cli/lib/appdata';
import { LoggerError } from 'cli/logger';

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
		throw new LoggerError( __( 'Preview site with not found in appdata' ) );
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

	return existingSequences.length > 0 ? Math.max( ...existingSequences ) + 1 : 1;
};

export async function saveSnapshotToAppdata(
	siteFolder: string,
	atomicSiteId: number,
	previewUrl: string
): Promise< Snapshot > {
	const userData = await readAppdata();
	const authToken = await getAuthToken();
	const site = await getSiteByFolder( siteFolder );

	if ( ! userData.snapshots ) {
		userData.snapshots = [];
	}

	const nextSequence = getNextSequenceNumber( site.id, userData.snapshots, authToken.id );
	const snapshot: Snapshot = {
		url: previewUrl,
		atomicSiteId,
		localSiteId: site.id,
		date: Date.now(),
		name: sprintf(
			/* translators: 1: Site name 2: Sequence number (e.g. "My Site Name Preview 1") */
			__( '%1$s Preview %2$d' ),
			site.name,
			nextSequence
		),
		sequence: nextSequence,
		userId: authToken.id,
	};

	userData.snapshots.push( snapshot );
	await saveAppdata( userData );
	return snapshot;
}

export async function deleteSnapshotFromAppdata( snapshotUrl: string ): Promise< void > {
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
}
