import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as sessionMetadata from '@studio/common/lib/session-metadata';
import { readSessionsMetadata, updateSessionMetadata } from '@studio/common/lib/session-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAiSessionsForSite } from '@studio/agent/node/sessions/manage';
import { setAiSessionSitePlacement } from '@studio/agent/node/sessions/placement';
import { createAiSession, listAiSessions } from '@studio/agent/node/sessions/store';

// Runs against a real temp directory: DEV_CONFIG_DIR points config.json and its lockfile at
// it, and session JSONLs live next to them.
describe( 'deleteAiSessionsForSite', () => {
	let tempDirectory: string;
	let sessionsRoot: string;

	beforeEach( async () => {
		tempDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-delete-sessions-' ) );
		sessionsRoot = path.join( tempDirectory, 'sessions' );
		process.env.DEV_CONFIG_DIR = path.join( tempDirectory, 'config' );
	} );

	afterEach( async () => {
		delete process.env.DEV_CONFIG_DIR;
		await fs.rm( tempDirectory, { recursive: true, force: true } );
	} );

	const createPlacedSession = async ( siteId: string, sitePath: string ) => {
		const summary = await createAiSession( sessionsRoot, {
			site: { name: 'Site', path: sitePath },
		} );
		await setAiSessionSitePlacement( summary.id, { siteId, sitePath, siteName: 'Site' } );
		return summary;
	};

	it( 'deletes matching sessions with their metadata', async () => {
		const byBoth = await createPlacedSession( 'site-1', '/sites/one' );
		const byPath = await createPlacedSession( 'other-id', '/sites/one' );
		const byId = await createPlacedSession( 'site-1', '/sites/moved' );
		const unrelated = await createPlacedSession( 'other-id', '/sites/other' );
		await updateSessionMetadata( byBoth.id, { archived: true } );
		await updateSessionMetadata( unrelated.id, { archived: true } );

		const deleted = await deleteAiSessionsForSite( sessionsRoot, {
			id: 'site-1',
			path: '/sites/one',
		} );

		expect( deleted.sort() ).toEqual( [ byBoth.id, byPath.id, byId.id ].sort() );
		const remaining = await listAiSessions( sessionsRoot );
		expect( remaining.map( ( session ) => session.id ) ).toEqual( [ unrelated.id ] );
		await expect( readSessionsMetadata() ).resolves.toEqual( {
			[ unrelated.id ]: {
				archived: true,
				placement: expect.objectContaining( { siteId: 'other-id' } ),
			},
		} );
	} );

	it( 'drops the metadata even when the session file is already gone', async () => {
		await setAiSessionSitePlacement( 'ghost-session', {
			siteId: 'site-1',
			sitePath: '/sites/one',
			siteName: 'Site',
		} );
		await updateSessionMetadata( 'ghost-session', { archived: true } );

		const deleted = await deleteAiSessionsForSite( sessionsRoot, {
			id: 'site-1',
			path: '/sites/one',
		} );

		expect( deleted ).toEqual( [ 'ghost-session' ] );
		await expect( readSessionsMetadata() ).resolves.toEqual( {} );
	} );

	it( 'deletes the transcripts and reports a failed config update', async () => {
		await createPlacedSession( 'site-1', '/sites/one' );
		const deleteSessionMetadata = vi
			.spyOn( sessionMetadata, 'deleteSessionMetadata' )
			.mockRejectedValueOnce( new Error( 'Failed to write the config.' ) );

		try {
			await expect(
				deleteAiSessionsForSite( sessionsRoot, { id: 'site-1', path: '/sites/one' } )
			).rejects.toThrow( 'Failed to write the config.' );
		} finally {
			deleteSessionMetadata.mockRestore();
		}

		await expect( listAiSessions( sessionsRoot ) ).resolves.toEqual( [] );
	} );
} );
