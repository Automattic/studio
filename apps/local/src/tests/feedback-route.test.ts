import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendStudioFeedback } from '@studio/common/lib/feedback';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';

vi.mock( '@studio/common/lib/feedback', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/feedback') >() ),
	sendStudioFeedback: vi.fn(),
} ) );

let server: LocalServer;
let configDir: string;

function writeToken() {
	writeFileSync(
		path.join( configDir, 'shared.json' ),
		JSON.stringify( {
			version: 1,
			authToken: {
				accessToken: 'token',
				expiresIn: 3600,
				expirationTime: Date.now() + 3_600_000,
				id: 1,
				email: 'user@example.com',
				displayName: 'User',
			},
		} )
	);
}

const post = ( body: unknown ) =>
	fetch( `${ server.url }/api/feedback`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( body ),
	} );

beforeEach( async () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-feedback-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
	server = await startLocalServer( {
		cliBinary: path.join( os.tmpdir(), 'studio-test-cli.mjs' ),
		sessionsRoot: path.join( os.tmpdir(), 'studio-test-sessions' ),
		sitesRoot: path.join( os.tmpdir(), 'studio-test-sites' ),
		port: 0,
		userAgent: 'WordPressStudio/9.9.9',
	} );
} );

afterEach( async () => {
	vi.mocked( sendStudioFeedback ).mockReset();
	await server.close();
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

describe( 'POST /api/feedback', () => {
	it( 'sends the report through the shared sender with the login token', async () => {
		writeToken();
		vi.mocked( sendStudioFeedback ).mockResolvedValue( { feedbackId: 42 } );
		const response = await post( { type: 'bug', message: 'It broke.' } );
		expect( response.status ).toBe( 200 );
		expect( await response.json() ).toEqual( { feedbackId: 42 } );
		expect( sendStudioFeedback ).toHaveBeenCalledWith(
			{ type: 'bug', message: 'It broke.' },
			{ accessToken: 'token', userAgent: 'WordPressStudio/9.9.9' }
		);
	} );

	it( 'rejects a report without a type or message', async () => {
		writeToken();
		expect( ( await post( { type: 'praise', message: 'Nice' } ) ).status ).toBe( 400 );
		expect( ( await post( { type: 'bug', message: '   ' } ) ).status ).toBe( 400 );
		expect( sendStudioFeedback ).not.toHaveBeenCalled();
	} );

	it( 'asks for a login when there is no token', async () => {
		const response = await post( { type: 'bug', message: 'It broke.' } );
		expect( response.status ).toBe( 401 );
		expect( await response.json() ).toEqual( {
			error: 'Log in to WordPress.com to send feedback.',
		} );
		expect( sendStudioFeedback ).not.toHaveBeenCalled();
	} );

	it( 'passes the service error on', async () => {
		writeToken();
		vi.mocked( sendStudioFeedback ).mockRejectedValue( new Error( 'Rate limited.' ) );
		const response = await post( { type: 'request', message: 'Add dark mode.' } );
		expect( response.status ).toBe( 502 );
		expect( await response.json() ).toEqual( { error: 'Rate limited.' } );
	} );
} );
