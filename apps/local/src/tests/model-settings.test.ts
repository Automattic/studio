import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveResumeSessionContext } from '@studio/agent/node/sessions/context';
import { createAiSession, loadAiSession } from '@studio/agent/node/sessions/store';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';

let directory: string;
let sessionsRoot: string;
let server: LocalServer;
beforeEach( async () => {
	directory = await mkdtemp( path.join( os.tmpdir(), 'studio-model-settings-' ) );
	process.env.DEV_CONFIG_DIR = directory;
	sessionsRoot = path.join( directory, 'sessions' );
	server = await startLocalServer( {
		cliBinary: '/unused-test-cli.mjs',
		sessionsRoot,
		sitesRoot: path.join( directory, 'sites' ),
		port: 0,
	} );
} );
afterEach( async () => {
	await server.close();
	delete process.env.DEV_CONFIG_DIR;
	await rm( directory, { recursive: true, force: true } );
} );

it( 'saves model and effort together through HTTP and rejects unsupported levels', async () => {
	const session = await createAiSession( sessionsRoot );
	const update = ( route: string, body: unknown ) =>
		fetch( `${ server.url }/api/sessions/${ session.id }/${ route }`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( body ),
		} );
	expect(
		( await update( 'provider', { provider: 'wpcom', model: 'balanced', effort: 'high' } ) ).status
	).toBe( 204 );
	expect(
		resolveResumeSessionContext( await loadAiSession( sessionsRoot, session.id ) )
	).toMatchObject( { provider: 'wpcom', model: 'balanced', effort: 'high' } );
	expect( ( await update( 'model', { model: 'balanced', effort: 'low' } ) ).status ).toBe( 204 );
	expect(
		resolveResumeSessionContext( await loadAiSession( sessionsRoot, session.id ) )
	).toMatchObject( { provider: 'wpcom', model: 'balanced', effort: 'low' } );
	expect( ( await update( 'model', { model: 'fast', effort: 'high' } ) ).status ).toBe( 400 );
	expect( ( await update( 'model', { model: 'balanced', effort: 'invented' } ) ).status ).toBe(
		400
	);
} );

it( 'round trips ordered favorites through the same preferences used by Desktop', async () => {
	const modelFavorites = [
		{ provider: 'wpcom', model: 'balanced', effort: 'high' },
		{ provider: 'wpcom', model: 'balanced', effort: 'default' },
	];
	const result = await fetch( `${ server.url }/api/user-preferences`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { modelFavorites } ),
	} );
	expect( result.status ).toBe( 204 );
	const preferences = await fetch( `${ server.url }/api/user-preferences` ).then( ( response ) =>
		response.json()
	);
	expect( preferences.modelFavorites ).toEqual( modelFavorites );
} );
