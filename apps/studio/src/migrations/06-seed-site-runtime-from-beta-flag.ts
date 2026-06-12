/**
 * The native PHP runtime used to be a global toggle: the `nativePhpRuntime`
 * beta feature made every site run on native PHP via the `STUDIO_RUNTIME`
 * environment variable. The runtime is now stored per site in `cli.json`
 * (`runtime` field, unset means Playground), so without this migration the
 * sites of users who had the beta feature enabled would silently fall back to
 * the Playground runtime. Seed `runtime: 'native-php'` on every site that has
 * no explicit runtime yet when the beta feature is on.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	CLI_CONFIG_LOCKFILE_NAME,
	LOCKFILE_STALE_TIME,
	LOCKFILE_WAIT_TIME,
} from '@studio/common/constants';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { SITE_RUNTIME_NATIVE_PHP, siteRuntimeSchema } from '@studio/common/lib/site-runtime';
import {
	getAppConfigPath,
	getCliConfigPath,
	getConfigDirectory,
} from '@studio/common/lib/well-known-paths';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import type { Migration } from '@studio/common/lib/migration';

const appBetaFeaturesShapeSchema = z
	.object( {
		betaFeatures: z.object( { nativePhpRuntime: z.boolean().optional() } ).loose().optional(),
	} )
	.loose();

const cliConfigShapeSchema = z
	.object( {
		sites: z
			.array( z.object( { runtime: siteRuntimeSchema.optional() } ).loose() )
			.default( () => [] ),
	} )
	.loose();

async function readJsonFile< T extends z.ZodType >(
	filePath: string,
	schema: T
): Promise< z.infer< T > | null > {
	if ( ! fs.existsSync( filePath ) ) {
		return null;
	}
	try {
		const raw = await readFile( filePath, { encoding: 'utf8' } );
		return schema.parse( JSON.parse( raw ) );
	} catch {
		return null;
	}
}

async function isNativePhpBetaFeatureEnabled(): Promise< boolean > {
	const appConfig = await readJsonFile( getAppConfigPath(), appBetaFeaturesShapeSchema );
	return appConfig?.betaFeatures?.nativePhpRuntime === true;
}

export const seedSiteRuntimeFromBetaFlag: Migration = {
	async needsToRun() {
		if ( ! ( await isNativePhpBetaFeatureEnabled() ) ) {
			return false;
		}
		const cliConfig = await readJsonFile( getCliConfigPath(), cliConfigShapeSchema );
		return !! cliConfig?.sites.some( ( site ) => site.runtime === undefined );
	},
	async run() {
		const lockfilePath = path.join( getConfigDirectory(), CLI_CONFIG_LOCKFILE_NAME );
		try {
			await lockFileAsync( lockfilePath, { wait: LOCKFILE_WAIT_TIME, stale: LOCKFILE_STALE_TIME } );
			const cliConfig = await readJsonFile( getCliConfigPath(), cliConfigShapeSchema );
			if ( ! cliConfig ) {
				return;
			}
			for ( const site of cliConfig.sites ) {
				site.runtime ??= SITE_RUNTIME_NATIVE_PHP;
			}
			await writeFile( getCliConfigPath(), JSON.stringify( cliConfig, null, 2 ) + '\n', {
				encoding: 'utf8',
			} );
			console.log( `Seeded native PHP runtime on ${ cliConfig.sites.length } existing site(s)` );
		} finally {
			await unlockFileAsync( lockfilePath );
		}
	},
};
