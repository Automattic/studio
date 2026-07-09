import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteAiSessionsForSite } from '@studio/common/ai/sessions/manage';
import {
	readAiSessionPlacements,
	setAiSessionSitePlacement,
} from '@studio/common/ai/sessions/placement';
import { createAiSession, listAiSessions } from '@studio/common/ai/sessions/store';
import { readSharedSessions, updateSharedSession } from '@studio/common/lib/shared-config';

// Runs against a real temp directory: DEV_CONFIG_DIR points app.json,
// shared.json and their lockfiles at it, and session JSONLs live next to them.
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

	it( 'deletes matching sessions with their placements and shared flags', async () => {
		const byBoth = await createPlacedSession( 'site-1', '/sites/one' );
		const byPath = await createPlacedSession( 'other-id', '/sites/one' );
		const byId = await createPlacedSession( 'site-1', '/sites/moved' );
		const unrelated = await createPlacedSession( 'other-id', '/sites/other' );
		await updateSharedSession( byBoth.id, { starred: true } );
		await updateSharedSession( unrelated.id, { starred: true } );

		const deleted = await deleteAiSessionsForSite( sessionsRoot, {
			id: 'site-1',
			path: '/sites/one',
		} );

		expect( deleted.sort() ).toEqual( [ byBoth.id, byPath.id, byId.id ].sort() );
		const remaining = await listAiSessions( sessionsRoot );
		expect( remaining.map( ( session ) => session.id ) ).toEqual( [ unrelated.id ] );
		await expect( readAiSessionPlacements() ).resolves.toEqual( {
			[ unrelated.id ]: expect.objectContaining( { siteId: 'other-id' } ),
		} );
		await expect( readSharedSessions() ).resolves.toEqual( {
			[ unrelated.id ]: { starred: true },
		} );
	} );

	it( 'drops placement and shared flags even when the session file is already gone', async () => {
		await setAiSessionSitePlacement( 'ghost-session', {
			siteId: 'site-1',
			sitePath: '/sites/one',
			siteName: 'Site',
		} );
		await updateSharedSession( 'ghost-session', { archived: true } );

		const deleted = await deleteAiSessionsForSite( sessionsRoot, {
			id: 'site-1',
			path: '/sites/one',
		} );

		expect( deleted ).toEqual( [ 'ghost-session' ] );
		await expect( readAiSessionPlacements() ).resolves.toEqual( {} );
		await expect( readSharedSessions() ).resolves.toEqual( {} );
	} );
} );
