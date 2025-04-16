import { getSiteFromFolder, readAppdata, saveAppdata, Snapshot } from 'cli/lib/appdata';
import { LoggerError } from 'cli/logger';

export async function getSnapshotsFromAppdata(
	userId: number,
	siteFolder?: string
): Promise< Snapshot[] > {
	const userData = await readAppdata();
	let snapshots = userData.snapshots ?? [];
	snapshots = snapshots.filter( ( snapshot ) => snapshot.userId === userId );

	if ( siteFolder ) {
		const site = await getSiteFromFolder( siteFolder );
		snapshots = snapshots.filter( ( snapshot ) => snapshot.localSiteId === site.id );
	}

	return snapshots;
}

export async function addPreviewSiteToAppdata(
	previewUrl: string,
	atomicSiteId: number,
	siteFolder: string
): Promise< Snapshot > {
	try {
		const userData = await readAppdata();
		const site = await getSiteFromFolder( siteFolder );
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
		userData.snapshots.push( snapshot );
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
