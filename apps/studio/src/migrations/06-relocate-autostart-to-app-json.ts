/**
 * Relocates the per-site `autoStart` flag out of CLI-owned `cli.json` and into Studio's Desktop-only
 * `app.json` (`siteMetadata[id].autoStart`), and converts the old boolean `stopSitesOnQuit` preference
 * into the new tri-state `quitSitesBehavior`.
 *
 * `autoStart` is a desktop-launch concept — only Studio reads it — so it now lives with Studio's other
 * per-site metadata. Runs once, gated by the `autoStartRelocated` marker. Any stale `autoStart` left in
 * `cli.json` is harmless: the CLI no longer reads or writes it.
 */

import fs from 'node:fs';
import { getCliConfigPath } from '@studio/common/lib/well-known-paths';
import { readFile } from 'atomically';
import { z } from 'zod';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { Migration } from '@studio/common/lib/migration';
import type { UserData } from 'src/storage/storage-types';

const cliAutoStartSchema = z
	.object( {
		sites: z
			.array( z.object( { id: z.string(), autoStart: z.boolean().optional() } ).loose() )
			.optional(),
	} )
	.loose();

async function readCliSitesAutoStart(): Promise< { id: string; autoStart?: boolean }[] > {
	const cliPath = getCliConfigPath();
	if ( ! fs.existsSync( cliPath ) ) {
		return [];
	}
	try {
		const raw = await readFile( cliPath, { encoding: 'utf8' } );
		const parsed = cliAutoStartSchema.safeParse( JSON.parse( raw ) );
		return parsed.success ? parsed.data.sites ?? [] : [];
	} catch {
		return [];
	}
}

export const relocateAutostartToAppJson: Migration = {
	async needsToRun() {
		const userData = await loadUserData();
		return ! userData.autoStartRelocated;
	},
	async run() {
		const cliSites = await readCliSitesAutoStart();

		try {
			await lockAppdata();
			const userData = await loadUserData();
			const legacy = userData as UserData & { stopSitesOnQuit?: boolean };

			// Seed per-site autoStart into Studio-owned app.json metadata.
			for ( const site of cliSites ) {
				if ( site.autoStart === undefined ) {
					continue;
				}
				userData.siteMetadata[ site.id ] = {
					...userData.siteMetadata[ site.id ],
					autoStart: site.autoStart,
				};
			}

			// Convert the old boolean quit preference. The previous "Stop sites" stopped sites but kept
			// them flagged to auto-start, so it maps to 'stop-and-auto-start'; the falsey value was
			// "Leave running".
			if ( legacy.stopSitesOnQuit !== undefined && userData.quitSitesBehavior === undefined ) {
				userData.quitSitesBehavior = legacy.stopSitesOnQuit
					? 'stop-and-auto-start'
					: 'leave-running';
			}
			delete legacy.stopSitesOnQuit;

			userData.autoStartRelocated = true;
			await saveUserData( userData );
		} finally {
			await unlockAppdata();
		}
	},
};
