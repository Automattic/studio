/**
 * Relocates the per-site `autoStart` flag out of CLI-owned `cli.json` into Studio's Desktop-only
 * `app.json` (`siteMetadata[id].autoStart`), and converts the legacy boolean `stopSitesOnQuit` quit
 * preference into the tri-state `quitSitesBehavior`.
 *
 * `autoStart` is a desktop-launch concept — only Studio acts on it — so it now lives with Studio's
 * other per-site metadata. The migration is self-gating without a stored marker: it runs whenever
 * `cli.json` still carries an `autoStart` flag (or `app.json` still has the legacy `stopSitesOnQuit`),
 * and strips those source fields once relocated, so it can't re-run or clobber freshly-tracked values.
 *
 * Like the 02/04 migrations it validates with a local, loose zod schema (so unrelated cli.json fields
 * survive the write-back) and reads/writes the file directly, since migrations run at startup before
 * the CLI daemon touches it.
 */

import fs from 'node:fs';
import { getCliConfigPath } from '@studio/common/lib/well-known-paths';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { Migration } from '@studio/common/lib/migration';
import type { UserData } from 'src/storage/storage-types';

const cliConfigSchema = z
	.object( {
		sites: z
			.array( z.object( { id: z.string(), autoStart: z.boolean().optional() } ).loose() )
			.optional(),
	} )
	.loose();

type CliConfig = z.infer< typeof cliConfigSchema >;

async function readCliConfig(): Promise< CliConfig | null > {
	const cliPath = getCliConfigPath();
	if ( ! fs.existsSync( cliPath ) ) {
		return null;
	}
	try {
		const parsed = cliConfigSchema.safeParse(
			JSON.parse( await readFile( cliPath, { encoding: 'utf8' } ) )
		);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

const autoStartSites = ( config: CliConfig | null ) =>
	( config?.sites ?? [] ).filter( ( site ) => site.autoStart !== undefined );

export const relocateAutostartToAppJson: Migration = {
	async needsToRun() {
		if ( autoStartSites( await readCliConfig() ).length > 0 ) {
			return true;
		}
		const userData = ( await loadUserData() ) as UserData & { stopSitesOnQuit?: boolean };
		return userData.stopSitesOnQuit !== undefined;
	},
	async run() {
		const cliConfig = await readCliConfig();
		const flagged = autoStartSites( cliConfig );

		try {
			await lockAppdata();
			const userData = ( await loadUserData() ) as UserData & { stopSitesOnQuit?: boolean };

			// Seed per-site autoStart into app.json, skipping anything Studio already tracks so a retry
			// after a crash can't clobber a fresher value.
			for ( const site of flagged ) {
				if ( ! site.id || userData.siteMetadata[ site.id ]?.autoStart !== undefined ) {
					continue;
				}
				userData.siteMetadata[ site.id ] = {
					...userData.siteMetadata[ site.id ],
					autoStart: site.autoStart,
				};
			}

			// The old "Stop sites" stopped sites but kept them flagged to auto-start, so a truthy
			// preference maps to 'stop-and-auto-start'; falsey was "Leave running".
			if ( userData.stopSitesOnQuit !== undefined && userData.quitSitesBehavior === undefined ) {
				userData.quitSitesBehavior = userData.stopSitesOnQuit
					? 'stop-and-auto-start'
					: 'leave-running';
			}
			delete userData.stopSitesOnQuit;

			await saveUserData( userData );
		} finally {
			await unlockAppdata();
		}

		// Strip the relocated flags from cli.json so the migration stays one-shot.
		if ( flagged.length > 0 && cliConfig?.sites ) {
			cliConfig.sites.forEach( ( site ) => {
				delete site.autoStart;
			} );
			await writeFile( getCliConfigPath(), JSON.stringify( cliConfig, null, 2 ) + '\n', {
				encoding: 'utf8',
			} );
		}
	},
};
