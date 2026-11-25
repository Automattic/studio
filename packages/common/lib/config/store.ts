import fs from 'fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { importLegacyConfig } from '@studio/common/lib/config/legacy-import';
import { migrateConfig } from '@studio/common/lib/config/migrations';
import {
	CONFIG_LISTS,
	CONFIG_SECTIONS,
	CONFIG_VERSION,
	EMPTY_SECTIONS,
	reportOnce,
	type Config,
	type ConfigSectionName,
} from '@studio/common/lib/config/schema';
import { captureException, redactHomePaths } from '@studio/common/lib/error-reporting';
import { hideDirectoryOnWindows } from '@studio/common/lib/hide-dir-windows';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';

/**
 * `~/.studio/config.json`, the one config file every Studio app and the CLI read and write. Reads
 * take no lock; `updateConfig` is the only way to write, so every write is locked. A file from an
 * older build is migrated, and the legacy files imported, under the lock on first read.
 */

export type RawConfig = Record< string, unknown >;

// The file was written by a newer Studio or Studio CLI than this one.
export class ConfigTooNewError extends Error {
	constructor( readonly fileVersion: number ) {
		super( 'Your Studio settings were saved by a newer version of Studio or the Studio CLI.' );
		this.name = 'ConfigTooNewError';
	}
}

const SECTION_NAMES = Object.keys( CONFIG_SECTIONS ) as ConfigSectionName[];

const insideUpdate = new AsyncLocalStorage< true >();

export function getConfigPath(): string {
	return path.join( getConfigDirectory(), 'config.json' );
}

export function isRecord( value: unknown ): value is RawConfig {
	return typeof value === 'object' && value !== null && ! Array.isArray( value );
}

export function parseRaw( content: string ): RawConfig | null {
	try {
		const parsed: unknown = JSON.parse( content );
		return isRecord( parsed ) ? parsed : null;
	} catch {
		return null;
	}
}

// Undefined when the file is missing; `null` when it isn't a JSON object.
async function readRaw(): Promise< RawConfig | null | undefined > {
	try {
		return parseRaw( await readFile( getConfigPath(), { encoding: 'utf8' } ) );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			return undefined;
		}
		throw error;
	}
}

function isCurrent( raw: RawConfig | null | undefined ): raw is RawConfig {
	if ( ! raw ) {
		return false;
	}
	if ( typeof raw.version === 'number' && raw.version > CONFIG_VERSION ) {
		throw new ConfigTooNewError( raw.version );
	}
	return raw.version === CONFIG_VERSION;
}

async function writeRawConfig( raw: RawConfig ): Promise< void > {
	await writeFile( getConfigPath(), JSON.stringify( raw, null, 2 ) + '\n', {
		encoding: 'utf8',
	} );
}

async function ensureConfigDirectory(): Promise< void > {
	const directory = getConfigDirectory();
	if ( ! fs.existsSync( directory ) ) {
		fs.mkdirSync( directory, { recursive: true } );
		await hideDirectoryOnWindows( directory );
	}
}

async function withLock< T >( run: () => Promise< T > ): Promise< T > {
	await ensureConfigDirectory();
	const lockPath = `${ getConfigPath() }.lock`;
	await lockFileAsync( lockPath, { wait: LOCKFILE_WAIT_TIME } );
	try {
		return await run();
	} finally {
		await unlockFileAsync( lockPath );
	}
}

// Brings the file up to date. Runs under the lock.
async function prepareRaw(): Promise< RawConfig > {
	const raw = await readRaw();
	if ( isCurrent( raw ) ) {
		return raw;
	}
	if ( raw ) {
		const migrated = migrateConfig( raw );
		await writeRawConfig( migrated );
		return migrated;
	}
	if ( raw === null ) {
		const aside = `${ getConfigPath() }.invalid-${ Date.now() }`;
		await fs.promises.rename( getConfigPath(), aside );
		captureException(
			new Error( `Moved an unreadable config file to ${ redactHomePaths( aside ) }` )
		);
	}
	const { config, retire } = await importLegacyConfig();
	await writeRawConfig( config );
	await retire();
	return config;
}

// The section as it goes back to disk. A list keeps the entries callers never saw.
function toStored( name: ConfigSectionName, value: unknown, stored: unknown ): unknown {
	if ( ! ( name in CONFIG_LISTS ) || ! Array.isArray( value ) || ! Array.isArray( stored ) ) {
		return value;
	}
	const item = CONFIG_LISTS[ name as keyof typeof CONFIG_LISTS ];
	return [ ...value, ...stored.filter( ( entry ) => ! item.safeParse( entry ).success ) ];
}

function parseSections( raw: RawConfig ): Config {
	const config = {} as Record< ConfigSectionName, unknown >;
	for ( const name of SECTION_NAMES ) {
		const parsed = CONFIG_SECTIONS[ name ].safeParse( raw[ name ] ?? EMPTY_SECTIONS[ name ] );
		if ( parsed.success ) {
			config[ name ] = parsed.data;
		} else {
			reportOnce( `Ignored the invalid "${ name }" config section: ${ parsed.error.message }` );
			config[ name ] = CONFIG_SECTIONS[ name ].parse( EMPTY_SECTIONS[ name ] );
		}
	}
	return config as Config;
}

export async function readConfig(): Promise< Config > {
	const raw = await readRaw();
	if ( isCurrent( raw ) ) {
		return parseSections( raw );
	}
	return parseSections( await withLock( prepareRaw ) );
}

// Synchronous startup consumers get the updated shape in memory. Only a locked read persists it.
export function readConfigSync(): Config {
	let raw: RawConfig | null = null;
	try {
		raw = parseRaw( fs.readFileSync( getConfigPath(), 'utf8' ) );
	} catch {
		// Missing.
	}
	if ( raw?.version === CONFIG_VERSION ) return parseSections( raw );
	if (
		raw &&
		typeof raw.version === 'number' &&
		Number.isInteger( raw.version ) &&
		raw.version >= 1 &&
		raw.version < CONFIG_VERSION
	) {
		return parseSections( migrateConfig( raw ) );
	}
	return parseSections( {} );
}

/**
 * Runs `update` on the current config under the lock and writes back the sections it changed,
 * leaving the others as they are on disk. Keep `update` short, without network requests: every
 * Studio process waits on the same lock. It can't call `updateConfig` again.
 */
export async function updateConfig< T >(
	update: ( config: Config ) => T | Promise< T >
): Promise< T > {
	if ( insideUpdate.getStore() ) {
		throw new Error( 'updateConfig was called inside another updateConfig.' );
	}
	return withLock( () =>
		insideUpdate.run( true, async () => {
			const raw = await prepareRaw();
			const config = parseSections( raw );
			const before = SECTION_NAMES.map( ( name ) => JSON.stringify( config[ name ] ) );
			const result = await update( config );
			const changed = SECTION_NAMES.filter(
				( name, index ) => JSON.stringify( config[ name ] ) !== before[ index ]
			);
			if ( changed.length ) {
				for ( const name of changed ) {
					raw[ name ] = toStored( name, config[ name ], raw[ name ] );
				}
				await writeRawConfig( raw );
			}
			return result;
		} )
	);
}
