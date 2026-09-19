import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { UserError } from './guards.ts';
import { JobQueue } from './jobs.ts';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let dir: string;
let server: Server;
let base: string;
let finish: ( () => void ) | undefined;

beforeEach( async () => {
	finish = undefined;
	dir = fs.mkdtempSync( path.join( os.tmpdir(), 'liberate-app-' ) );
	const config = {
		...loadConfig( { NODE_ENV: 'production', LIBERATE_DATA_DIR: dir } ),
		minFreeDiskBytes: 0,
	};
	const queue = new JobQueue( {
		dir: path.join( dir, 'jobs' ),
		concurrency: 1,
		maxQueued: 10,
		timeoutMs: 60_000,
		retentionMs: 60_000,
		run: ( _job, { filesDir } ) =>
			new Promise( ( resolve ) => {
				finish = () => {
					fs.writeFileSync( path.join( filesDir, 'site.zip' ), 'zip' );
					resolve( {
						counts: { pages: 1, posts: 0, media: 0, products: 0 },
						truncated: false,
						files: { site: 3 },
					} );
				};
			} ),
	} );
	await queue.load();
	const app = await createApp( {
		config,
		queue,
		log: () => {},
		checkHost: async ( host ) => {
			if ( host === 'intranet.corp.com' ) {
				throw new UserError( 'That address isn’t a public website.' );
			}
		},
	} );
	server = app.listen( 0 );
	base = `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }`;
} );

afterEach( () => {
	server.close();
	fs.rmSync( dir, { recursive: true, force: true } );
} );

const createJob = ( body: object ) =>
	fetch( `${ base }/api/jobs`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( body ),
	} );

describe( 'API', () => {
	it( 'rejects jobs without consent, with bad URLs, or for private hosts', async () => {
		for ( const body of [
			{ url: 'mysite.com' },
			{ url: 'ftp://mysite.com', consent: true },
			{ url: 'intranet.corp.com', consent: true },
		] ) {
			const response = await createJob( body );
			expect( response.status ).toBe( 400 );
			expect( ( await response.json() ).error ).toBeTruthy();
		}
	} );

	it( 'creates a job, reports it, and serves its download once done', async () => {
		const response = await createJob( { url: 'mysite.com', consent: true } );
		expect( response.status ).toBe( 201 );
		const { id, status } = await response.json();
		expect( status ).toBe( 'running' );

		const files = `${ base }/api/jobs/${ id }/files`;
		expect( ( await fetch( `${ files }/site` ) ).status ).toBe( 404 );

		await vi.waitFor( () => expect( finish ).toBeDefined() );
		finish!();
		await vi.waitFor( async () =>
			expect( ( await ( await fetch( `${ base }/api/jobs/${ id }` ) ).json() ).status ).toBe(
				'done'
			)
		);
		const download = await fetch( `${ files }/site` );
		expect( download.headers.get( 'content-disposition' ) ).toContain( 'mysite.com-wordpress.zip' );
		expect( await download.text() ).toBe( 'zip' );
		expect( ( await fetch( `${ files }/content` ) ).status ).toBe( 404 );
		expect( ( await fetch( `${ files }/constructor` ) ).status ).toBe( 404 );
	} );

	it( 'returns 404 for unknown or malformed job ids', async () => {
		expect( ( await fetch( `${ base }/api/jobs/${ 'a'.repeat( 22 ) }` ) ).status ).toBe( 404 );
		expect( ( await fetch( `${ base }/api/jobs/..%2F..%2Fetc` ) ).status ).toBe( 404 );
	} );
} );
