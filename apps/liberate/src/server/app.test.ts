import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { UserError } from './guards.ts';
import { fileStore } from './store.ts';
import type { PreviewClient, Session } from './wpcom.ts';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const ID = 'a'.repeat( 32 );

let dir: string;
let server: Server;
let base: string;
let session: Session;
let refuse: Error | undefined;
let revoked: string[];

const client: PreviewClient = {
	async create() {
		if ( refuse ) {
			const thrown = refuse;
			refuse = undefined;
			throw thrown;
		}
		return session;
	},
	async status() {
		return session;
	},
	async revoke( id ) {
		revoked.push( id );
		return session;
	},
	async sizeOf() {
		return 1024;
	},
};

beforeEach( async () => {
	session = { session_id: ID, state: 'capturing', progress: { pages_captured: 2, pages_total: 8 } };
	refuse = undefined;
	revoked = [];
	dir = fs.mkdtempSync( path.join( os.tmpdir(), 'liberate-app-' ) );
	const config = loadConfig( {
		NODE_ENV: 'production',
		LIBERATE_DATA_DIR: dir,
		WPCOM_CLIENT_ID: '149292',
		WPCOM_CLIENT_SECRET: 'secret',
	} );
	const app = await createApp( {
		config,
		store: fileStore( path.join( dir, 'jobs' ) ),
		client,
		log: () => {},
		checkHost: async ( host ) => {
			if ( host === 'intranet.corp.com' ) {
				throw new UserError( 'That address isn’t a public website.' );
			}
		},
	} );
	server = app.listen( 0 );
	base = `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }`;
	// Only the app's own outbound calls are stubbed; requests to it go through.
	const realFetch = globalThis.fetch;
	vi.stubGlobal(
		'fetch',
		vi.fn( async ( input: RequestInfo | URL, init?: RequestInit ) => {
			const url = String( input instanceof Request ? input.url : input );
			return url.startsWith( base )
				? realFetch( input, init )
				: new Response( '<title>Sonora</title>' );
		} )
	);
} );

afterEach( () => {
	server.close();
	vi.unstubAllGlobals();
	fs.rmSync( dir, { recursive: true, force: true } );
} );

const create = ( body: unknown ) =>
	fetch( `${ base }/api/jobs`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify( body ),
	} );

describe( 'POST /api/jobs', () => {
	it( 'starts a capture and answers with the job', async () => {
		const response = await create( { url: 'mysite.com', consent: true } );
		expect( response.status ).toBe( 201 );
		await expect( response.json() ).resolves.toMatchObject( {
			id: ID,
			host: 'mysite.com',
			siteName: 'Sonora',
			status: 'running',
			step: 'capture',
			counts: { pages: 2 },
		} );
	} );

	it.each( [
		[ 'without consent', { url: 'mysite.com' }, /own this site/ ],
		[ 'for a address that is not a site', { url: 'not a url', consent: true }, /address/i ],
		[ 'for a private host', { url: 'intranet.corp.com', consent: true }, /public website/ ],
	] )( 'refuses %s', async ( _case, body, message ) => {
		const response = await create( body );
		expect( response.status ).toBe( 400 );
		await expect( response.json() ).resolves.toMatchObject( {
			error: expect.stringMatching( message ),
		} );
	} );

	it( 'passes on what WordPress.com says when it will not start one', async () => {
		refuse = new UserError( 'liberate.sh is at capacity right now. Please try again later.', 503 );
		const response = await create( { url: 'mysite.com', consent: true } );
		expect( response.status ).toBe( 503 );
		await expect( response.json() ).resolves.toMatchObject( { error: /capacity/ } );
	} );

	it( 'frees the slot an older finished capture is holding, rather than refusing', async () => {
		// A capture that is already done, holding one of the app's three slots.
		session = { session_id: ID, state: 'preview_ready' };
		await create( { url: 'mysite.com', consent: true } );

		refuse = Object.assign( new Error( 'full' ), {
			code: 'static_site_import_session_limit_exceeded',
		} );
		const response = await create( { url: 'other.com', consent: true } );

		expect( response.status ).toBe( 201 );
		expect( revoked ).toEqual( [ ID ] );
	} );

	it( 'still refuses when every slot is held by a capture that is running', async () => {
		session = { session_id: ID, state: 'capturing' };
		await create( { url: 'mysite.com', consent: true } );

		refuse = Object.assign( new Error( 'full' ), {
			code: 'static_site_import_session_limit_exceeded',
		} );
		const response = await create( { url: 'other.com', consent: true } );

		expect( response.status ).toBe( 503 );
		expect( revoked ).toEqual( [] );
	} );
} );

describe( 'GET /api/jobs/:id', () => {
	it( 'reports the session behind a known job, with the name it was given', async () => {
		await create( { url: 'mysite.com', consent: true } );
		session = {
			session_id: ID,
			state: 'preview_ready',
			archive_url: 'https://archives.example.com/site.zip',
			preview_summary: { pages: 9, quality_pass: false },
		};

		const view = await fetch( `${ base }/api/jobs/${ ID }` ).then( ( response ) =>
			response.json()
		);
		expect( view ).toMatchObject( {
			status: 'done',
			progress: 1,
			siteName: 'Sonora',
			counts: { pages: 9 },
			bytes: 1024,
			warning: expect.stringContaining( 'didn’t convert cleanly' ),
		} );
	} );

	it.each( [
		[ 'an id this app never issued', 'b'.repeat( 32 ) ],
		[ 'something that is not an id', 'nope' ],
	] )( 'answers 404 for %s', async ( _case, id ) => {
		const response = await fetch( `${ base }/api/jobs/${ id }` );
		expect( response.status ).toBe( 404 );
	} );
} );

describe( 'GET /api/jobs/:id/files/site', () => {
	it( 'sends the visitor to the signed archive', async () => {
		await create( { url: 'mysite.com', consent: true } );
		session = {
			session_id: ID,
			state: 'preview_ready',
			archive_url: 'https://archives.example.com/site.zip',
		};

		const response = await fetch( `${ base }/api/jobs/${ ID }/files/site`, { redirect: 'manual' } );
		expect( response.status ).toBe( 302 );
		expect( response.headers.get( 'location' ) ).toBe( 'https://archives.example.com/site.zip' );
	} );

	it( 'answers 404 while there is no archive yet', async () => {
		await create( { url: 'mysite.com', consent: true } );
		const response = await fetch( `${ base }/api/jobs/${ ID }/files/site`, { redirect: 'manual' } );
		expect( response.status ).toBe( 404 );
	} );
} );
