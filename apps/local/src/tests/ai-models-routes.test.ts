import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';

// Driven over HTTP, against a model server on this computer that lists two models.

let server: LocalServer;
let modelServer: Server;
let modelServerUrl: string;
let configDir: string;
let sessionsRoot: string;

function connectLocalServer() {
	writeFileSync(
		path.join( configDir, 'shared.json' ),
		JSON.stringify( {
			version: 1,
			providerConfigs: {
				'local-llm': { method: 'server', baseUrl: `${ modelServerUrl }/v1`, model: 'qwen3:0.6b' },
			},
		} )
	);
}

async function createSession(): Promise< string > {
	const response = await fetch( `${ server.url }/api/sessions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: '{}',
	} );
	return ( ( await response.json() ) as { id: string } ).id;
}

const post = ( url: string, body: unknown ) =>
	fetch( `${ server.url }${ url }`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( body ),
	} );

beforeEach( async () => {
	modelServer = createServer( ( request, response ) => {
		response.setHeader( 'Content-Type', 'application/json' );
		if ( request.url === '/v1/models' ) {
			response.end(
				JSON.stringify( {
					data: [
						{ id: 'qwen3:0.6b', architecture: { input_modalities: [ 'text' ] } },
						{ id: 'gemma3:4b', architecture: { input_modalities: [ 'text', 'image' ] } },
					],
				} )
			);
			return;
		}
		response.statusCode = 404;
		response.end( '{}' );
	} );
	await new Promise< void >( ( resolve ) => modelServer.listen( 0, '127.0.0.1', resolve ) );
	const address = modelServer.address() as { port: number };
	modelServerUrl = `http://127.0.0.1:${ address.port }`;
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-ai-models-' ) );
	sessionsRoot = path.join( configDir, 'sessions' );
	process.env.DEV_CONFIG_DIR = configDir;
	server = await startLocalServer( {
		cliBinary: path.join( os.tmpdir(), 'studio-test-cli.mjs' ),
		sessionsRoot,
		sitesRoot: path.join( os.tmpdir(), 'studio-test-sites' ),
		port: 0,
	} );
} );

afterEach( async () => {
	await server.close();
	await new Promise( ( resolve ) => modelServer.close( resolve ) );
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

describe( 'a local model server', () => {
	it( 'lists the models the server serves now', async () => {
		connectLocalServer();

		const response = await fetch( `${ server.url }/api/ai-settings/providers/local-llm/models` );

		expect( response.status ).toBe( 200 );
		expect( await response.json() ).toEqual( [
			{ id: 'local-llm/qwen3:0.6b', name: 'qwen3:0.6b', supportsImages: false },
			{ id: 'local-llm/gemma3:4b', name: 'gemma3:4b', supportsImages: true },
		] );
	} );

	it( 'says the server isn’t answering when it has stopped', async () => {
		connectLocalServer();
		await new Promise( ( resolve ) => modelServer.close( resolve ) );
		modelServer = createServer();

		const response = await fetch( `${ server.url }/api/ai-settings/providers/local-llm/models` );

		expect( response.ok ).toBe( false );
		expect( await response.json() ).toEqual( {
			error: `The local server at ${ modelServerUrl } isn’t answering. Start it, then send your message again.`,
		} );
	} );

	it( 'pins a chat to a local model, and switches it to another', async () => {
		connectLocalServer();
		const id = await createSession();

		expect(
			( await post( `/api/sessions/${ id }/provider`, { provider: 'anthropic', model: 'fast' } ) )
				.status
		).toBe( 400 );
		expect(
			(
				await post( `/api/sessions/${ id }/provider`, {
					provider: 'local-llm',
					model: 'local-llm/gemma3:4b',
				} )
			).status
		).toBe( 204 );

		expect(
			( await post( `/api/sessions/${ id }/model`, { model: 'local-llm/qwen3:0.6b' } ) ).status
		).toBe( 204 );
		const session = await ( await fetch( `${ server.url }/api/sessions/${ id }` ) ).json();
		expect( JSON.stringify( session.entries ) ).toContain( 'local-llm/gemma3:4b' );
		expect( JSON.stringify( session.entries ) ).toContain( 'local-llm/qwen3:0.6b' );
	} );
} );
