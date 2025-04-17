import { Snapshot } from 'common/types/snapshot';
import { getSiteByFolder, readAppdata, saveAppdata } from 'cli/lib/appdata';
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

// Insert or update a snapshot entry (matching on atomicSiteId) in the appdata file.
export async function upsertPreviewSiteInAppdata(
	siteFolder: string,
	atomicSiteId: number,
	previewUrl: string
): Promise< Snapshot > {
	try {
		const userData = await readAppdata();
		const site = await getSiteByFolder( siteFolder );
		const snapshot: Snapshot = {
			url: previewUrl,
			atomicSiteId,
			localSiteId: site.id,
			date: Date.now(),
			name: site.name,
		};
		if ( userData.authToken?.id ) {
			snapshot.userId = userData.authToken.id;
		}
		if ( ! userData.snapshots ) {
			userData.snapshots = [];
		}

		const existingSnapshotIndex = userData.snapshots.findIndex(
			( s ) => s.atomicSiteId === atomicSiteId
		);

		if ( existingSnapshotIndex > -1 ) {
			userData.snapshots.splice( existingSnapshotIndex, 1, snapshot );
		} else {
			userData.snapshots.push( snapshot );
		}

		await saveAppdata( userData );
		return snapshot;
	} catch ( error ) {
		throw new LoggerError(
			`Failed to add preview site to appdata: ${
				error instanceof Error ? error.message : String( error )
			}`
		);
	}
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
