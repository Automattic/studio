import { z } from 'zod';
import { readAppdata, saveAppdata, snapshotSchema } from 'cli/lib/appdata';
import { LoggerError } from 'cli/logger';

export async function addPreviewSiteToAppdata(
	previewUrl: string,
	atomicSiteId: number,
	siteFolder: string
): Promise< void > {
	try {
		const userData = await readAppdata();
		const site = userData.sites?.find( ( s ) => s.path === siteFolder );
		if ( ! site ) {
			return;
		}
		const snapshot: z.infer< typeof snapshotSchema > = {
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
	} catch ( error ) {
		throw new LoggerError(
			`Failed to add preview site to appdata: ${
				error instanceof Error ? error.message : String( error )
			}`
		);
	}
}
