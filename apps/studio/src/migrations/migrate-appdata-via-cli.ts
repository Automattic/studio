/**
 * Migrates appdata-v1.json from the platform-specific Electron location
 * into the three new config files at ~/.studio/:
 *
 * - shared.json: auth token + locale
 * - cli.json: sites + snapshots
 * - appdata.json: Desktop-only state (UI prefs, sync, etc.)
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
	if ( process.platform === 'win32' ) {
		return path.join( process.env.APPDATA || '', 'Studio', 'appdata-v1.json' );
	}
	return path.join( os.homedir(), 'Library', 'Application Support', 'Studio', 'appdata-v1.json' );
}

function getNewAppdataPath(): string {
	return path.join( getSharedConfigDirectory(), 'appdata.json' );
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

// CLI site schema: siteDetailsSchema fields + latestCliPid (added by cli-config)
const cliSiteSchema = siteDetailsSchema
	.extend( {
		latestCliPid: z.number().optional(),
	} )
	.partial();

// Shared config fields (excluding version, which we set ourselves)
const sharedConfigFields = Object.keys( sharedConfigSchema.shape ).filter(
	( key ) => key !== 'version'
);

function pick(
	obj: Record< string, unknown >,
	keys: readonly string[]
): Record< string, unknown > {
	const result: Record< string, unknown > = {};
	for ( const key of keys ) {
		if ( key in obj ) {
			result[ key ] = obj[ key ];
		}
	}
	return result;
}

/**
 * Fields from the old appdata that move to shared.json.
 */
function buildSharedConfig( oldData: Record< string, unknown > ): Record< string, unknown > {
	return { version: 1, ...pick( oldData, sharedConfigFields ) };
}

/**
 * Fields from the old appdata that move to cli.json.
 */
const cliSiteFields = Object.keys( cliSiteSchema.shape );

function buildCliConfig( oldData: Record< string, unknown > ): Record< string, unknown > {
	const config: Record< string, unknown > = {
		version: 1,
		sites: [],
		snapshots: [],
	};

	if ( Array.isArray( oldData.sites ) ) {
		config.sites = oldData.sites.map( ( site: Record< string, unknown > ) =>
			pick( site, cliSiteFields )
		);
	}

	if ( Array.isArray( oldData.snapshots ) ) {
		config.snapshots = oldData.snapshots;
	}

	return config;
}

/**
 * Fields from the old appdata that stay in the new appdata.json.
 * Sites keep only Desktop-specific fields (themeDetails, sortOrder).
 *
 * We derive the "keep" set by excluding fields that moved to shared.json or cli.json.
 */
const movedTopLevelFields = new Set( [ ...sharedConfigFields, 'sites', 'snapshots', 'version' ] );

// Per-site fields that stay in appdata.json: anything NOT in the CLI site schema,
// NOT in the snapshot schema, and NOT runtime state.
const excludedSiteFields = new Set( [
	...cliSiteFields,
	...Object.keys( snapshotSchema.shape ),
	'running',
] );

function pickAppdataSiteFields( site: Record< string, unknown > ): Record< string, unknown > {
	const result: Record< string, unknown > = {};
	for ( const key of Object.keys( site ) ) {
		if ( ! excludedSiteFields.has( key ) && key !== 'id' ) {
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
			const fields = pickAppdataSiteFields( site );
			if ( Object.keys( fields ).length > 0 ) {
				sitesRecord[ id ] = fields;
			}
		}

		if ( Object.keys( sitesRecord ).length > 0 ) {
			config.sites = sitesRecord;
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
	// appdata.json, the next boot will retry the migration since we check for
	// appdata.json existence as the completion marker.
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
