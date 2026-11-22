import { z } from 'zod';
import { snapshotSchema } from '../../types/snapshot';
import { destinationConnection, lastTransferTime, recordTransfer } from '../site-connections';
import { CONFIG_VERSION, siteConnectionSchema } from './schema';
import type { RawConfig } from './store';

const localConnections = z.object( {
	id: z.string(),
	connections: z.array( siteConnectionSchema ).optional(),
} );

function movePreviewBaselines( raw: RawConfig ): RawConfig {
	if ( ! Array.isArray( raw.sites ) || ! Array.isArray( raw.snapshots ) ) return raw;
	const sites = structuredClone( raw.sites );
	const locals = new Map< string, z.infer< typeof localConnections > >();
	for ( const site of sites ) {
		if ( localConnections.safeParse( site ).success ) locals.set( site.id, site );
	}
	const snapshots = raw.snapshots.map( ( entry ) => {
		const result = snapshotSchema.safeParse( entry );
		if ( ! result.success ) return entry;
		const { localSiteId, userId, atomicSiteId, syncedAt, versionId } = result.data;
		const local = locals.get( localSiteId );
		if ( ! local || userId === undefined || ( syncedAt === undefined && versionId === undefined ) )
			return entry;
		if ( syncedAt !== undefined && ! Number.isFinite( new Date( syncedAt ).getTime() ) )
			return entry;

		const connection = destinationConnection(
			local,
			'wpcom',
			String( userId ),
			atomicSiteId,
			true
		);
		const previousTime = lastTransferTime( connection );
		// A newer transfer wins, including a partial transfer that cleared the version.
		if ( syncedAt === undefined ) {
			if ( previousTime === undefined && connection.localVersionId === undefined )
				connection.localVersionId = versionId;
		} else if (
			previousTime === undefined
				? connection.localVersionId === undefined
				: syncedAt > previousTime ||
				  ( syncedAt === previousTime && connection.localVersionId === undefined )
		) {
			recordTransfer( connection, 'push', versionId, syncedAt );
		}
		const { versionId: _version, syncedAt: _time, ...snapshot } = entry;
		return snapshot;
	} );
	return { ...raw, sites, snapshots };
}

/**
 * The steps that bring a config file from an older build up to `CONFIG_VERSION`: the step at index
 * `n` turns version `n + 1` into version `n + 2`. Each is a pure function of the raw file, so it
 * runs the same in every Studio app and is tested input against output.
 */
const STEPS: ( ( raw: RawConfig ) => RawConfig )[] = [ movePreviewBaselines ];

export function migrateConfig( raw: RawConfig ): RawConfig {
	let migrated = raw;
	for ( let version = Number( raw.version ) || 1; version < CONFIG_VERSION; version++ ) {
		migrated = STEPS[ version - 1 ]( migrated );
	}
	return { ...migrated, version: CONFIG_VERSION };
}
