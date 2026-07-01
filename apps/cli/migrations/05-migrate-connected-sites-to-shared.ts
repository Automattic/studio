/**
 * Copies `connectedWpcomSites` from the Desktop-owned `app.json` into the
 * shared `shared.json` so the CLI can read and write it through the helpers
 * in `packages/common/lib/connected-sites.ts`.
 *
 * Runs only when app.json carries the legacy field AND shared.json does not
 * already have it — the CLI must never modify app.json. The Studio app runs
 * its own migration to strip the field once it boots; until then the legacy
 * copy in app.json is harmless because both the new Studio and the new CLI
 * read connections from shared.json.
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
import { readFile } from 'atomically';
import { z } from 'zod';
import type { Migration } from '@studio/common/lib/migration';

const appConnectedShapeSchema = z
	.object( {
		connectedWpcomSites: z.record( z.string(), z.array( syncSiteSchema ) ).optional(),
	} )
	.loose();

async function readAppConnectedSites(): Promise< Record<
	string,
	z.infer< typeof syncSiteSchema >[]
> | null > {
	const appPath = getAppConfigPath();
	if ( ! fs.existsSync( appPath ) ) {
		return null;
	}
	try {
		const raw = await readFile( appPath, { encoding: 'utf8' } );
		const parsed = appConnectedShapeSchema.safeParse( JSON.parse( raw ) );
		if ( ! parsed.success ) {
			return null;
		}
		return parsed.data.connectedWpcomSites ?? null;
	} catch {
		return null;
	}
}

export const migrateConnectedSitesToShared: Migration = {
	async needsToRun() {
		const appConnected = await readAppConnectedSites();
		if ( ! appConnected || Object.keys( appConnected ).length === 0 ) {
			return false;
		}
		const shared = await readSharedConfig().catch( () => null );
		return ! shared?.connectedWpcomSites;
	},

	async run() {
		const appConnected = await readAppConnectedSites();
		if ( ! appConnected || Object.keys( appConnected ).length === 0 ) {
			return;
		}
		try {
			await lockSharedConfig();
			const shared = await readSharedConfig();
			if ( shared.connectedWpcomSites ) {
				return;
			}
			await saveSharedConfig( { ...shared, connectedWpcomSites: appConnected } );
		} finally {
			await unlockSharedConfig();
		}
	},
};
