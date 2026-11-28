import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { startLocalServer } from '../index';

it( 'rejects malformed reply references before starting a run', async () => {
	const directory = mkdtempSync( path.join( os.tmpdir(), 'studio-reply-route-' ) );
	const previous = process.env.DEV_CONFIG_DIR;
	process.env.DEV_CONFIG_DIR = directory;
	const server = await startLocalServer( {
		cliBinary: path.join( directory, 'unused-cli.mjs' ),
		sessionsRoot: path.join( directory, 'sessions' ),
		sitesRoot: path.join( directory, 'sites' ),
		port: 0,
	} );
	try {
		const response = await fetch( `${ server.url }/api/sessions/test/messages`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( {
				prompt: 'Which part?',
				reply: { sessionId: 'chat', entryId: 'message', excerpt: 42 },
			} ),
		} );
		expect( response.status ).toBe( 400 );
		expect( await response.json() ).toMatchObject( { error: 'Invalid reply reference.' } );
	} finally {
		await server.close();
		if ( previous === undefined ) delete process.env.DEV_CONFIG_DIR;
		else process.env.DEV_CONFIG_DIR = previous;
		rmSync( directory, { recursive: true, force: true } );
	}
} );
