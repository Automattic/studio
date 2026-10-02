import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileStore, type JobRecord } from './store.ts';

const record = ( id: string, expiresAt: number ): JobRecord => ( {
	id,
	url: `https://${ id }.com/`,
	host: `${ id }.com`,
	createdAt: 0,
	expiresAt,
} );

let dir: string;
beforeEach( () => {
	dir = fs.mkdtempSync( path.join( os.tmpdir(), 'liberate-store-' ) );
} );
afterEach( () => fs.rmSync( dir, { recursive: true, force: true } ) );

describe( 'fileStore', () => {
	it( 'keeps a record and reads it back', async () => {
		const store = fileStore( dir );
		await store.put( record( 'live', Date.now() + 60_000 ) );
		await expect( store.get( 'live' ) ).resolves.toMatchObject( { host: 'live.com' } );
	} );

	it( 'forgets a record once it has expired', async () => {
		const store = fileStore( dir );
		await store.put( record( 'stale', Date.now() - 1 ) );
		await expect( store.get( 'stale' ) ).resolves.toBeUndefined();
		expect( fs.readdirSync( dir ) ).toEqual( [] );
	} );

	it( 'lists live records, oldest first', async () => {
		const store = fileStore( dir );
		await store.put( { ...record( 'new', Date.now() + 60_000 ), createdAt: 2 } );
		await store.put( { ...record( 'old', Date.now() + 60_000 ), createdAt: 1 } );
		await store.put( record( 'stale', Date.now() - 1 ) );
		await expect( store.list().then( ( all ) => all.map( ( one ) => one.id ) ) ).resolves.toEqual( [
			'old',
			'new',
		] );
	} );

	it( 'answers for an id it has never seen', async () => {
		await expect( fileStore( dir ).get( 'nobody' ) ).resolves.toBeUndefined();
	} );

	it( 'prunes what has expired and leaves the rest', async () => {
		const store = fileStore( dir );
		await store.put( record( 'live', Date.now() + 60_000 ) );
		await store.put( record( 'stale', Date.now() - 1 ) );
		await expect( store.prune() ).resolves.toEqual( [ 'stale' ] );
		expect( fs.readdirSync( dir ) ).toEqual( [ 'live.json' ] );
	} );
} );
