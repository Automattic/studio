import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UserError } from './guards.ts';
import { JobQueue, type JobResult, type QueueOptions, type Runner } from './jobs.ts';
import type { JobView } from '../shared.ts';

const RESULT: JobResult = {
	platform: 'Wix',
	counts: { pages: 3 },
	files: { site: 100 },
};

/** Never finishes on its own; fails once aborted. */
const hang: Runner = ( _job, { signal } ) =>
	new Promise( ( _resolve, reject ) => {
		signal.addEventListener( 'abort', () => reject( signal.reason ) );
	} );

let dir: string;
beforeEach( () => {
	dir = fs.mkdtempSync( path.join( os.tmpdir(), 'liberate-jobs-' ) );
} );
afterEach( () => {
	fs.rmSync( dir, { recursive: true, force: true } );
} );

function makeQueue( run: Runner, options: Partial< QueueOptions > = {} ) {
	return new JobQueue( {
		dir,
		run,
		concurrency: 1,
		maxQueued: 10,
		timeoutMs: 5_000,
		retentionMs: 60_000,
		...options,
	} );
}

/** Resolve with the job's view once it reaches a final status. */
function settled( queue: JobQueue, id: string ) {
	return new Promise< JobView >( ( resolve ) => {
		const check = ( view?: JobView ) => {
			if ( view?.id === id && ( view.status === 'done' || view.status === 'failed' ) ) {
				queue.off( 'update', check );
				resolve( view );
			}
		};
		queue.on( 'update', check );
		check( queue.view( id ) );
	} );
}

describe( 'JobQueue', () => {
	it( 'runs jobs one at a time, in order, and reports queue positions', async () => {
		const order: string[] = [];
		const queue = makeQueue( async ( job, { report } ) => {
			order.push( job.host );
			report( { step: 'capture', progress: 0.5 } );
			return RESULT;
		} );
		await queue.load();
		const first = queue.create( 'https://first.com/' );
		const second = queue.create( 'https://second.com/' );
		expect( queue.view( second.id )?.queuePosition ).toBe( 1 );

		const view = await settled( queue, second.id );
		expect( order ).toEqual( [ 'first.com', 'second.com' ] );
		expect( view ).toMatchObject( {
			status: 'done',
			progress: 1,
			platform: 'Wix',
			files: RESULT.files,
		} );
		expect( view.expiresAt ).toBeGreaterThan( Date.now() );
		expect( queue.view( first.id )?.status ).toBe( 'done' );
	} );

	it( 'shows user errors, but hides internal ones', async () => {
		const queue = makeQueue( async ( job ) => {
			throw job.host === 'user.com'
				? new UserError( 'No pages here.' )
				: new Error( 'ENOENT /data' );
		} );
		await queue.load();
		const user = queue.create( 'https://user.com/' );
		const internal = queue.create( 'https://internal.com/' );
		expect( ( await settled( queue, user.id ) ).error ).toBe( 'No pages here.' );
		expect( ( await settled( queue, internal.id ) ).error ).not.toContain( 'ENOENT' );
	} );

	it( 'stops jobs that run past the timeout', async () => {
		const queue = makeQueue( hang, { timeoutMs: 50 } );
		await queue.load();
		const { id } = queue.create( 'https://slow.com/' );
		expect( ( await settled( queue, id ) ).error ).toMatch( /took longer than/ );
	} );

	it( 'allows one active job per visitor and caps the queue', async () => {
		const queue = makeQueue( hang, { maxQueued: 1 } );
		await queue.load();
		queue.create( 'https://a.com/', 'visitor' );
		expect( () => queue.create( 'https://b.com/', 'visitor' ) ).toThrow( 'already have a site' );
		queue.create( 'https://b.com/', 'someone-else' );
		expect( () => queue.create( 'https://c.com/', 'third' ) ).toThrow( 'very busy' );
		await queue.shutdown();
	} );

	it( 'restarts jobs after a shutdown without using up an attempt, but gives up after two crashes', async () => {
		let queue = makeQueue( hang );
		await queue.load();
		const { id } = queue.create( 'https://restart.com/' );
		await vi.waitFor( () => expect( queue.stats().running ).toBe( 1 ) );
		await queue.shutdown();
		const interrupted = JSON.parse( fs.readFileSync( path.join( dir, id, 'job.json' ), 'utf8' ) );
		expect( interrupted ).toMatchObject( { status: 'running', attempts: 0 } );

		queue = makeQueue( async () => RESULT );
		await queue.load();
		expect( ( await settled( queue, id ) ).status ).toBe( 'done' );
		await queue.shutdown();

		const stuck = JSON.parse( fs.readFileSync( path.join( dir, id, 'job.json' ), 'utf8' ) );
		fs.writeFileSync(
			path.join( dir, id, 'job.json' ),
			JSON.stringify( { ...stuck, status: 'running', attempts: 2 } )
		);
		queue = makeQueue( async () => RESULT );
		await queue.load();
		expect( queue.view( id )?.status ).toBe( 'failed' );
	} );

	it( 'deletes expired jobs and their files', async () => {
		const queue = makeQueue( async () => RESULT, { retentionMs: 1_000 } );
		await queue.load();
		const { id } = queue.create( 'https://old.com/' );
		await settled( queue, id );
		expect( fs.existsSync( path.join( dir, id ) ) ).toBe( true );

		await queue.sweep( Date.now() + 2_000 );
		expect( queue.view( id ) ).toBeUndefined();
		expect( fs.existsSync( path.join( dir, id ) ) ).toBe( false );
	} );
} );
