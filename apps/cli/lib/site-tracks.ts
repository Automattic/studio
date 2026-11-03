import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { z } from 'zod';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import type { Snapshot } from '@studio/common/types/snapshot';

export async function getSiteTracksProps(
	siteFolder: string,
	preview?: Pick< Snapshot, 'atomicSiteId' | 'userId' >
): Promise< { site_id?: string; preview_id?: string } > {
	try {
		await lockCliConfig();
		try {
			const config = await readCliConfig();
			const site = config.sites.find( ( candidate ) =>
				arePathsEqual( candidate.path, siteFolder )
			);
			const snapshot =
				preview &&
				config.snapshots.find(
					( candidate ) =>
						candidate.atomicSiteId === preview.atomicSiteId && candidate.userId === preview.userId
				);
			let changed = false;
			for ( const record of [ site, snapshot ] ) {
				if ( record && ! z.uuidv4().safeParse( record.tracksId ).success ) {
					record.tracksId = crypto.randomUUID();
					changed = true;
				}
			}
			if ( changed ) {
				await saveCliConfig( config );
			}
			return {
				...( site ? { site_id: site.tracksId } : {} ),
				...( snapshot ? { preview_id: snapshot.tracksId } : {} ),
			};
		} finally {
			await unlockCliConfig();
		}
	} catch {
		// ID persistence must not affect site or preview operations or the existing event.
		return {};
	}
}
