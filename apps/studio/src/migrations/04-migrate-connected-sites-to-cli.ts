/**
 * Moves `connectedWpcomSites` from `app.json` into per-site entries in
 * `cli.json`. Before this migration the Desktop app owned the connection
 * list under a top-level `connectedWpcomSites: { [userId]: SyncSite[] }`
 * in app.json. After this migration the list lives at
 * `cli.json sites[].connectedWpcomSites[userId]`, where both the Desktop
 * app and the Studio CLI can read and write it through shared helpers in
 * `tools/common/lib/connected-sites.ts`.
 *
 * The migration intentionally leaves app.json's copy intact and only
 * writes cli.json. We rely on the runtime code switching over to reading
 * from cli.json; a later cleanup migration will remove the legacy field
 * once we're confident no release still depends on it.
 */

import fs from 'node:fs';
import { getAppConfigPath, getCliConfigPath } from '@studio/common/lib/well-known-paths';
import { syncSiteSchema } from '@studio/common/types/sync';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import type { Migration } from '@studio/common/lib/migration';

const appConnectedShapeSchema = z
	.object( {
		connectedWpcomSites: z.record( z.string(), z.array( syncSiteSchema ) ).optional(),
	} )
	.loose();

const cliSiteShapeSchema = z
	.object( {
		id: z.string(),
		connectedWpcomSites: z.record( z.string(), z.array( syncSiteSchema ) ).optional(),
	} )
	.loose();

const cliConfigShapeSchema = z
	.object( {
		sites: z.array( cliSiteShapeSchema ).optional(),
	} )
	.loose();

const MIGRATION_MARKER_KEY = 'connectedWpcomSitesMigratedToCli';

const appMarkerShapeSchema = z
	.object( {
		[ MIGRATION_MARKER_KEY ]: z.boolean().optional(),
	} )
	.loose();

async function readJson( filePath: string ): Promise< Record< string, unknown > | null > {
	if ( ! fs.existsSync( filePath ) ) {
		return null;
	}
	try {
		const raw = await readFile( filePath, { encoding: 'utf8' } );
		return JSON.parse( raw );
	} catch {
		return null;
	}
}

async function writeJson( filePath: string, data: Record< string, unknown > ): Promise< void > {
	const fileContent = JSON.stringify( data, null, 2 ) + '\n';
	await writeFile( filePath, fileContent, { encoding: 'utf8' } );
}

export const migrateConnectedSitesToCli: Migration = {
	async needsToRun() {
		const appRaw = await readJson( getAppConfigPath() );
		if ( ! appRaw ) {
			return false;
		}
		const marker = appMarkerShapeSchema.safeParse( appRaw );
		if ( marker.success && marker.data[ MIGRATION_MARKER_KEY ] ) {
			return false;
		}
		const parsed = appConnectedShapeSchema.safeParse( appRaw );
		const users = parsed.success ? parsed.data.connectedWpcomSites ?? {} : {};
		return Object.keys( users ).length > 0;
	},

	async run() {
		const appPath = getAppConfigPath();
		const cliPath = getCliConfigPath();

		const appRaw = await readJson( appPath );
		if ( ! appRaw ) {
			return;
		}
		const appParsed = appConnectedShapeSchema.safeParse( appRaw );
		const connectedByUser = appParsed.success ? appParsed.data.connectedWpcomSites ?? {} : {};

		const cliRaw = ( await readJson( cliPath ) ) ?? { version: 1, sites: [], snapshots: [] };
		const cliParsed = cliConfigShapeSchema.safeParse( cliRaw );
		const existingSites = cliParsed.success ? cliParsed.data.sites ?? [] : [];

		// Fold the flat `{ userId: [ sites... ] }` shape into per-site
		// `{ localSiteId: { userId: [sites...] } }` keyed by local site id.
		const grouped = new Map< string, Record< string, z.infer< typeof syncSiteSchema >[] > >();
		for ( const [ userId, sites ] of Object.entries( connectedByUser ) ) {
			for ( const site of sites ) {
				const bucket = grouped.get( site.localSiteId ) ?? {};
				const list = bucket[ userId ] ?? [];
				if ( ! list.some( ( existing ) => existing.id === site.id ) ) {
					list.push( site );
				}
				bucket[ userId ] = list;
				grouped.set( site.localSiteId, bucket );
			}
		}

		const mergedSites = existingSites.map( ( site ) => {
			const incoming = grouped.get( site.id );
			if ( ! incoming ) {
				return site;
			}
			const merged: Record< string, z.infer< typeof syncSiteSchema >[] > = {
				...( site.connectedWpcomSites ?? {} ),
			};
			for ( const [ userId, sites ] of Object.entries( incoming ) ) {
				const existing = merged[ userId ] ?? [];
				const byId = new Map( existing.map( ( s ) => [ s.id, s ] ) );
				for ( const s of sites ) {
					byId.set( s.id, { ...byId.get( s.id ), ...s } );
				}
				merged[ userId ] = Array.from( byId.values() );
			}
			return { ...site, connectedWpcomSites: merged };
		} );

		const nextCli = { ...( cliRaw as Record< string, unknown > ), sites: mergedSites };
		await writeJson( cliPath, nextCli );

		const nextApp = {
			...( appRaw as Record< string, unknown > ),
			[ MIGRATION_MARKER_KEY ]: true,
		};
		// Intentionally preserve `connectedWpcomSites` in app.json for now so older
		// Studio versions continue to function until this migration has shipped widely.
		await writeJson( appPath, nextApp );
	},
};
