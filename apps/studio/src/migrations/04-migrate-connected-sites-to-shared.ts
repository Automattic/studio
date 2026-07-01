/**
 * Moves `connectedWpcomSites` from `app.json` into `shared.json` so both the
 * Studio app and the Studio CLI can read and write it through the helpers in
 * `packages/common/lib/connected-sites.ts`.
 *
 * Runs whenever app.json still carries the legacy `connectedWpcomSites`
 * field. The copy into shared.json is skipped if shared.json already has the
 * field (e.g. the CLI's own migration ran first), but the field is always
 * stripped from app.json — once both halves of Studio agree that
 * connections live in shared.json there's no reason to keep the stale copy
 * around. Data loss is bounded: an older Studio that boots after this
 * migration will simply re-add an empty `connectedWpcomSites` to app.json,
 * which the next run of this migration will clean up.
 */

import fs from 'node:fs';
import {
	lockSharedConfig,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
} from '@studio/common/lib/shared-config';
import { getAppConfigPath } from '@studio/common/lib/well-known-paths';
import { syncSiteSchema } from '@studio/common/types/sync';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { lockAppdata, unlockAppdata } from 'src/storage/user-data';
import type { Migration } from '@studio/common/lib/migration';

const appConnectedShapeSchema = z
	.object( {
		connectedWpcomSites: z.record( z.string(), z.array( syncSiteSchema ) ).optional(),
	} )
	.loose();

async function readAppConfigWithConnectedWpcomSites() {
	const appPath = getAppConfigPath();
	if ( ! fs.existsSync( appPath ) ) {
		return null;
	}
	try {
		const raw = await readFile( appPath, { encoding: 'utf8' } );
		const parsed = JSON.parse( raw );
		return appConnectedShapeSchema.parse( parsed );
	} catch {
		return null;
	}
}

export const migrateConnectedSitesToShared: Migration = {
	async needsToRun() {
		const parsed = await readAppConfigWithConnectedWpcomSites();
		return !! parsed?.connectedWpcomSites && Object.keys( parsed.connectedWpcomSites ).length > 0;
	},
	async run() {
		const parsed = await readAppConfigWithConnectedWpcomSites();
		if ( ! parsed ) {
			return;
		}

		try {
			await lockSharedConfig();
			const shared = await readSharedConfig();
			if ( ! shared.connectedWpcomSites ) {
				await saveSharedConfig( {
					...shared,
					connectedWpcomSites: parsed.connectedWpcomSites,
				} );
			}
		} finally {
			await unlockSharedConfig();
		}

		try {
			await lockAppdata();
			const { connectedWpcomSites: _legacy, ...rest } = parsed;
			await writeFile( getAppConfigPath(), JSON.stringify( rest, null, 2 ) + '\n', {
				encoding: 'utf8',
			} );
		} finally {
			await unlockAppdata();
		}
	},
};
