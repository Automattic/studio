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
import { siteDetailsSchema } from '@studio/common/lib/cli-events';
import {
	getSharedConfigDirectory,
	getSharedConfigPath,
	sharedConfigSchema,
} from '@studio/common/lib/shared-config';
import { snapshotSchema } from '@studio/common/types/snapshot';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { sanitizeUserpath } from 'src/lib/sanitize-for-logging';

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

function getNewAppdataPath(): string {
	return path.join( getSharedConfigDirectory(), 'app.json' );
}

function getCliConfigPath(): string {
	return path.join( getSharedConfigDirectory(), 'cli.json' );
}

function ensureDirectory( filePath: string ): void {
	const dir = path.dirname( filePath );
	if ( ! fs.existsSync( dir ) ) {
		fs.mkdirSync( dir, { recursive: true } );
	}
}

// Zod schemas used to extract and validate fields for each config file.
// Using .parse() ensures only valid, expected fields are written.

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
				}
				return acc;
			},
			[]
		);
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

function pickAppdataSiteMetadata( site: Record< string, unknown > ): Record< string, unknown > {
	const result: Record< string, unknown > = {};
	for ( const key of Object.keys( site ) ) {
		if ( ! excludedSiteFields.has( key ) ) {
			result[ key ] = site[ key ];
		}
	}
	return result;
}

function buildAppdataConfig( oldData: Record< string, unknown > ): Record< string, unknown > {
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
			const fields = pickAppdataSiteMetadata( site );
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
	ensureDirectory( filePath );
	const content = JSON.stringify( data, null, 2 ) + '\n';
	await writeFile( filePath, content, { encoding: 'utf8' } );
}

export async function migrateAppdata(): Promise< void > {
	const newAppdataPath = getNewAppdataPath();

	// If new appdata already exists, migration was already completed.
	if ( fs.existsSync( newAppdataPath ) ) {
		return;
	}

	const oldPath = getOldAppdataPath();

	if ( ! fs.existsSync( oldPath ) ) {
		return;
	}

	const rawContent = await readFile( oldPath, { encoding: 'utf8' } );
	let oldData: Record< string, unknown >;
	try {
		oldData = JSON.parse( rawContent );
	} catch {
		console.error(
			`Failed to parse old appdata at ${ sanitizeUserpath( oldPath ) }, skipping migration`
		);
		return;
	}

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

	await writeJsonFile( newAppdataPath, buildAppdataConfig( oldData ) );
	console.log(
		`Migrated Desktop settings from ${ sanitizeUserpath( oldPath ) } to ${ sanitizeUserpath(
			newAppdataPath
		) }`
	);
}
