import fs from 'fs';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { CLI_CONFIG_LOCKFILE_NAME, LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '../constants';
import { syncSiteSchema, type SyncSite } from '../types/sync';
import { lockFileAsync, unlockFileAsync } from './lockfile';
import { getCurrentUserId } from './shared-config';
import { getCliConfigPath, getConfigDirectory } from './well-known-paths';

/**
 * Permissive schema for reading/writing cli.json from shared helpers.
 *
 * We deliberately keep this schema loose so the Studio app and CLI can each
 * advance their authoritative cli.json schema independently without this
 * layer corrupting fields the other side owns. We only touch the
 * `connectedWpcomSites` field on each site entry.
 */
const permissiveCliConfigSchema = z
	.object( {
		version: z.number().optional(),
		sites: z
			.array(
				z
					.object( {
						id: z.string(),
						connectedWpcomSites: z.record( z.string(), z.array( syncSiteSchema ) ).optional(),
					} )
					.loose()
			)
			.optional(),
	} )
	.loose();

type PermissiveCliConfig = z.infer< typeof permissiveCliConfigSchema >;

function getLockfilePath(): string {
	return path.join( getConfigDirectory(), CLI_CONFIG_LOCKFILE_NAME );
}

async function lockCliConfig(): Promise< void > {
	await lockFileAsync( getLockfilePath(), {
		wait: LOCKFILE_WAIT_TIME,
		stale: LOCKFILE_STALE_TIME,
	} );
}

async function unlockCliConfig(): Promise< void > {
	await unlockFileAsync( getLockfilePath() );
}

async function readConfig(): Promise< PermissiveCliConfig > {
	const configPath = getCliConfigPath();
	if ( ! fs.existsSync( configPath ) ) {
		return { version: 1, sites: [] };
	}
	const fileContent = await readFile( configPath, { encoding: 'utf8' } );
	const parsed = JSON.parse( fileContent );
	return permissiveCliConfigSchema.parse( parsed );
}

async function writeConfig( config: PermissiveCliConfig ): Promise< void > {
	const configDir = getConfigDirectory();
	if ( ! fs.existsSync( configDir ) ) {
		fs.mkdirSync( configDir, { recursive: true } );
	}
	const configPath = getCliConfigPath();
	const fileContent = JSON.stringify( config, null, 2 ) + '\n';
	await writeFile( configPath, fileContent, { encoding: 'utf8' } );
}

/**
 * Stamp a SyncSite onto a local site entry. Ensures `localSiteId` is
 * consistent and defaults timestamps to null so the schema always validates.
 */
function normalizeStoredSite( site: SyncSite, localSiteId: string ): SyncSite {
	return {
		...site,
		localSiteId,
		lastPullTimestamp: site.lastPullTimestamp ?? null,
		lastPushTimestamp: site.lastPushTimestamp ?? null,
	};
}

async function updateSiteConnections(
	localSiteId: string,
	userId: number,
	updater: ( current: SyncSite[] ) => SyncSite[]
): Promise< SyncSite[] > {
	try {
		await lockCliConfig();
		const config = await readConfig();
		const sites = config.sites ?? [];
		const siteIndex = sites.findIndex( ( s ) => s.id === localSiteId );
		if ( siteIndex === -1 ) {
			return [];
		}
		const site = sites[ siteIndex ];
		const byUser = { ...( site.connectedWpcomSites ?? {} ) };
		const current = byUser[ String( userId ) ] ?? [];
		const next = updater( current );
		if ( next.length === 0 ) {
			delete byUser[ String( userId ) ];
		} else {
			byUser[ String( userId ) ] = next;
		}
		sites[ siteIndex ] = {
			...site,
			connectedWpcomSites: Object.keys( byUser ).length > 0 ? byUser : undefined,
		};
		await writeConfig( { ...config, sites } );
		return next;
	} finally {
		await unlockCliConfig();
	}
}

/**
 * Returns the WordPress.com sites connected to the given local site for the
 * currently authenticated user. Reads from cli.json without taking a lock —
 * callers must accept eventually-consistent reads.
 */
export async function getConnectedWpcomSitesForLocalSite(
	localSiteId: string
): Promise< SyncSite[] > {
	const userId = await getCurrentUserId();
	if ( ! userId ) {
		return [];
	}
	const config = await readConfig().catch( () => ( { sites: [] } ) as PermissiveCliConfig );
	const site = config.sites?.find( ( s ) => s.id === localSiteId );
	return site?.connectedWpcomSites?.[ String( userId ) ] ?? [];
}

/**
 * Returns every connection stored for the current user, across all local
 * sites. Preserves the order the sites appear in cli.json.
 */
export async function getAllConnectedWpcomSitesForCurrentUser(): Promise< SyncSite[] > {
	const userId = await getCurrentUserId();
	if ( ! userId ) {
		return [];
	}
	const config = await readConfig().catch( () => ( { sites: [] } ) as PermissiveCliConfig );
	const result: SyncSite[] = [];
	for ( const site of config.sites ?? [] ) {
		const forUser = site.connectedWpcomSites?.[ String( userId ) ];
		if ( forUser ) {
			result.push( ...forUser );
		}
	}
	return result;
}

/**
 * Adds a WordPress.com site connection to a local site for the current user.
 * Idempotent — if the remote site is already connected, the existing entry is
 * updated with the latest fields (including timestamps).
 */
export async function addConnectedWpcomSite(
	localSiteId: string,
	site: SyncSite
): Promise< SyncSite[] > {
	const userId = await getCurrentUserId();
	if ( ! userId ) {
		return [];
	}
	return updateSiteConnections( localSiteId, userId, ( current ) => {
		const normalized = normalizeStoredSite(
			{ ...site, syncSupport: 'already-connected' },
			localSiteId
		);
		const existingIndex = current.findIndex( ( c ) => c.id === normalized.id );
		if ( existingIndex === -1 ) {
			return [ ...current, normalized ];
		}
		const merged = [ ...current ];
		merged[ existingIndex ] = { ...current[ existingIndex ], ...normalized };
		return merged;
	} );
}

/**
 * Removes a WordPress.com site connection from a local site for the current
 * user. Safe to call when the connection doesn't exist.
 */
export async function removeConnectedWpcomSite(
	localSiteId: string,
	remoteSiteId: number
): Promise< SyncSite[] > {
	const userId = await getCurrentUserId();
	if ( ! userId ) {
		return [];
	}
	return updateSiteConnections( localSiteId, userId, ( current ) =>
		current.filter( ( c ) => c.id !== remoteSiteId )
	);
}

/**
 * Updates specific connection entries in place (matched by remote site id)
 * for the current user. Entries that don't match an existing connection are
 * skipped — use `addConnectedWpcomSite` to create new ones.
 */
export async function updateConnectedWpcomSites(
	localSiteId: string,
	updates: SyncSite[]
): Promise< SyncSite[] > {
	const userId = await getCurrentUserId();
	if ( ! userId ) {
		return [];
	}
	return updateSiteConnections( localSiteId, userId, ( current ) => {
		const next = [ ...current ];
		for ( const update of updates ) {
			const idx = next.findIndex( ( c ) => c.id === update.id );
			if ( idx !== -1 ) {
				next[ idx ] = normalizeStoredSite( { ...next[ idx ], ...update }, localSiteId );
			}
		}
		return next;
	} );
}

/**
 * Convenience: stamp the push or pull timestamp for a single connection.
 * Used by CLI push/pull after success so the Desktop UI shows an up-to-date
 * "Last synced" without needing its own write path.
 */
export async function markConnectedWpcomSiteSynced(
	localSiteId: string,
	remoteSiteId: number,
	direction: 'push' | 'pull'
): Promise< void > {
	const userId = await getCurrentUserId();
	if ( ! userId ) {
		return;
	}
	const timestamp = new Date().toISOString();
	await updateSiteConnections( localSiteId, userId, ( current ) =>
		current.map( ( c ) => {
			if ( c.id !== remoteSiteId ) {
				return c;
			}
			return direction === 'push'
				? { ...c, lastPushTimestamp: timestamp }
				: { ...c, lastPullTimestamp: timestamp };
		} )
	);
}
