/**
 * Migrates appdata-v1.json from the platform-specific Electron location
 * into the three new config files at ~/.studio/:
 *
 * - shared.json: auth token + locale
 * - cli.json: sites + snapshots
 * - app.json: Desktop-only state (UI prefs, sync, etc.)
 *
 * The old file is left intact intentionally — cleanup will happen
 * in a future release after migration is validated.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import * as Sentry from '@sentry/electron/main';
import { siteDetailsSchema } from '@studio/common/lib/cli-events';
import { sharedConfigSchema } from '@studio/common/lib/shared-config';
import {
	getAppConfigPath,
	getCliConfigPath,
	getSharedConfigPath,
} from '@studio/common/lib/well-known-paths';
import { snapshotSchema } from '@studio/common/types/snapshot';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { sanitizeUserpath } from 'src/lib/sanitize-for-logging';
import type { Migration } from '@studio/common/lib/migration';

/**
 * Returns the old platform-specific appdata path used by previous Studio versions.
 * macOS: ~/Library/Application Support/Studio/appdata-v1.json
 * Windows: %APPDATA%\Studio\appdata-v1.json
 */
function getOldAppdataPath(): string {
	if ( process.env.E2E && process.env.E2E_APP_DATA_PATH ) {
		return path.join( process.env.E2E_APP_DATA_PATH, 'Studio', 'appdata-v1.json' );
	}
	if ( process.platform === 'win32' ) {
		return path.join( process.env.APPDATA || '', 'Studio', 'appdata-v1.json' );
	}
	return path.join( os.homedir(), 'Library', 'Application Support', 'Studio', 'appdata-v1.json' );
}

const sharedConfigExtractSchema = z.object( {
	...sharedConfigSchema.omit( { version: true } ).shape,
} );

const cliSiteSchema = siteDetailsSchema.extend( {
	url: z.string().optional(),
	latestCliPid: z.number().optional(),
} );

function buildSharedConfig( oldData: Record< string, unknown > ): Record< string, unknown > {
	const parsed = sharedConfigExtractSchema.safeParse( oldData );
	return { version: 1, ...( parsed.success ? parsed.data : {} ) };
}

function buildCliConfig( oldData: Record< string, unknown > ): Record< string, unknown > {
	const config: Record< string, unknown > = {
		version: 1,
		sites: [],
		snapshots: [],
	};

	if ( Array.isArray( oldData.sites ) ) {
		config.sites = oldData.sites.reduce( ( acc: unknown[], site: Record< string, unknown > ) => {
			const result = cliSiteSchema.safeParse( site );
			if ( result.success ) {
				acc.push( result.data );
			} else {
				Sentry.captureException( result.error, {
					extra: { siteId: site.id, context: 'migrate-to-split-config' },
				} );
			}
			return acc;
		}, [] );
	}

	if ( Array.isArray( oldData.snapshots ) ) {
		config.snapshots = oldData.snapshots.reduce(
			( acc: unknown[], snapshot: Record< string, unknown > ) => {
				const result = snapshotSchema.safeParse( snapshot );
				if ( result.success ) {
					acc.push( result.data );
				} else {
					Sentry.captureException( result.error, {
						extra: { snapshotUrl: snapshot.url, context: 'migrate-to-split-config' },
					} );
				}
				return acc;
			},
			[]
		);
	}

	if ( typeof oldData.aiProvider === 'string' ) {
		config.aiProvider = oldData.aiProvider;
	}

	if ( typeof oldData.anthropicApiKey === 'string' ) {
		config.anthropicApiKey = oldData.anthropicApiKey;
	}

	return config;
}

// Top-level fields that moved to shared.json or cli.json (excluded from app.json).
const movedTopLevelFields = new Set( [
	...Object.keys( sharedConfigExtractSchema.shape ),
	'sites',
	'snapshots',
	'version',
] );

// Per-site fields managed by CLI or runtime — excluded from app.json site entries.
const excludedSiteFields = new Set( [
	...Object.keys( cliSiteSchema.shape ),
	...Object.keys( snapshotSchema.shape ),
	'id',
	'running',
] );

function pickAppSiteMetadata( site: Record< string, unknown > ): Record< string, unknown > {
	const result: Record< string, unknown > = {};
	for ( const key of Object.keys( site ) ) {
		if ( ! excludedSiteFields.has( key ) ) {
			result[ key ] = site[ key ];
		}
	}
	return result;
}

function buildAppConfig( oldData: Record< string, unknown > ): Record< string, unknown > {
	const config: Record< string, unknown > = { version: 1 };

	for ( const key of Object.keys( oldData ) ) {
		if ( ! movedTopLevelFields.has( key ) ) {
			config[ key ] = oldData[ key ];
		}
	}

	if ( Array.isArray( oldData.sites ) ) {
		const sitesRecord: Record< string, Record< string, unknown > > = {};
		for ( const site of oldData.sites ) {
			const id = site.id as string;
			if ( ! id ) {
				continue;
			}
			const fields = pickAppSiteMetadata( site );
			if ( Object.keys( fields ).length > 0 ) {
				sitesRecord[ id ] = fields;
			}
		}

		if ( Object.keys( sitesRecord ).length > 0 ) {
			config.siteMetadata = sitesRecord;
		}
	}

	return config;
}

async function writeJsonFile( filePath: string, data: Record< string, unknown > ): Promise< void > {
	const dir = path.dirname( filePath );
	if ( ! fs.existsSync( dir ) ) {
		fs.mkdirSync( dir, { recursive: true } );
	}
	const content = JSON.stringify( data, null, 2 ) + '\n';
	await writeFile( filePath, content, { encoding: 'utf8' } );
}

export const migrateAppConfig: Migration = {
	async needsToRun() {
		const newAppdataPath = getAppConfigPath();
		if ( fs.existsSync( newAppdataPath ) ) {
			return false;
		}
		const oldPath = getOldAppdataPath();
		return fs.existsSync( oldPath );
	},
	async run() {
		const oldPath = getOldAppdataPath();
		const rawContent = await readFile( oldPath, { encoding: 'utf8' } );
		const oldData: Record< string, unknown > = JSON.parse( rawContent );

		// Write shared.json and cli.json first — if the process crashes before writing
		// app.json, the next boot will retry the migration since we check for
		// app.json existence as the completion marker.
		const sharedConfigPath = getSharedConfigPath();
		if ( ! fs.existsSync( sharedConfigPath ) ) {
			await writeJsonFile( sharedConfigPath, buildSharedConfig( oldData ) );
			console.log( `Migrated auth/locale to ${ sanitizeUserpath( sharedConfigPath ) }` );
		}

		const cliConfigPath = getCliConfigPath();
		if ( ! fs.existsSync( cliConfigPath ) ) {
			await writeJsonFile( cliConfigPath, buildCliConfig( oldData ) );
			console.log( `Migrated sites/snapshots to ${ sanitizeUserpath( cliConfigPath ) }` );
		}

		const newAppdataPath = getAppConfigPath();
		await writeJsonFile( newAppdataPath, buildAppConfig( oldData ) );
		console.log(
			`Migrated Desktop settings from ${ sanitizeUserpath( oldPath ) } to ${ sanitizeUserpath(
				newAppdataPath
			) }`
		);
	},
};
