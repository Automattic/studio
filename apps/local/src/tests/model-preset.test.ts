import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAiSession, loadAiSession } from '@studio/agent/node/sessions/store';
import {
	resolveSessionModel,
	resolveSessionProvider,
	resolveSessionThinking,
} from '@studio/agent/protocol/sessions/model';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';

let directory: string;
let server: LocalServer;

beforeEach( async () => {
	directory = mkdtempSync( path.join( os.tmpdir(), 'studio-model-preset-' ) );
	process.env.DEV_CONFIG_DIR = directory;
	server = await startLocalServer( {
		cliBinary: path.join( directory, 'cli.mjs' ),
		sessionsRoot: path.join( directory, 'sessions' ),
		sitesRoot: path.join( directory, 'sites' ),
		port: 0,
	} );
} );

afterEach( async () => {
	await server.close();
	delete process.env.DEV_CONFIG_DIR;
	rmSync( directory, { recursive: true, force: true } );
} );

it( 'records the provider, model, and thinking in one session entry', async () => {
	const root = path.join( directory, 'sessions' );
	const session = await createAiSession( root );
	const post = ( thinking: string ) =>
		fetch( `${ server.url }/api/sessions/${ session.id }/provider`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { provider: 'anthropic', model: 'claude-sonnet-5-5', thinking } ),
		} );

	expect( ( await post( 'high' ) ).status ).toBe( 204 );
	const { entries } = await loadAiSession( root, session.id );
	const contexts = entries.filter( ( entry ) => entry.type === 'custom' );
	expect( contexts ).toHaveLength( 1 );
	expect( contexts[ 0 ] ).toMatchObject( {
		type: 'custom',
		customType: 'studio.session_context',
		data: { provider: 'anthropic-api-key', model: 'claude-sonnet-5-5', thinking: 'high' },
	} );
	expect( ( await post( 'xhigh' ) ).status ).toBe( 400 );
	expect( ( await loadAiSession( root, session.id ) ).entries ).toHaveLength( entries.length );
	const changeModel = await fetch( `${ server.url }/api/sessions/${ session.id }/model`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { model: 'claude-opus-5-5', thinking: 'low' } ),
	} );
	expect( changeModel.status ).toBe( 204 );
	const updated = ( await loadAiSession( root, session.id ) ).entries;
	expect( resolveSessionProvider( updated ) ).toBe( 'anthropic' );
	expect( resolveSessionModel( updated ) ).toBe( 'claude-opus-5-5' );
	expect( resolveSessionThinking( updated, 'claude-opus-5-5' ) ).toBe( 'low' );
	const invalid = await fetch( `${ server.url }/api/sessions/${ session.id }/model`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { model: 'claude-opus-5-5', thinking: 'xhigh' } ),
	} );
	expect( invalid.status ).toBe( 400 );
	expect( ( await loadAiSession( root, session.id ) ).entries ).toHaveLength( updated.length );
} );
