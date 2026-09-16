import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startStaticServer, type StaticServer } from './static-server.ts';

let temporaryDirectory: string | undefined;
let server: StaticServer | undefined;

afterEach( async () => {
	await server?.close();
	server = undefined;
	if ( temporaryDirectory ) {
		await rm( temporaryDirectory, { recursive: true, force: true } );
		temporaryDirectory = undefined;
	}
} );

describe( 'marketing screenshot static server', () => {
	it( 'serves only the renderer shell and its assets', async () => {
		temporaryDirectory = await mkdtemp( path.join( os.tmpdir(), 'studio-marketing-server-' ) );
		await Promise.all( [
			writeFile( path.join( temporaryDirectory, 'index.marketing.html' ), 'renderer shell' ),
			writeFile( path.join( temporaryDirectory, 'app.js' ), 'renderer asset' ),
		] );
		server = await startStaticServer( temporaryDirectory );

		await expect( fetch( server.origin ).then( ( response ) => response.text() ) ).resolves.toBe(
			'renderer shell'
		);
		await expect(
			fetch( server.origin, { headers: { 'sec-fetch-dest': 'iframe' } } ).then( ( response ) =>
				response.text()
			)
		).resolves.toBe( 'renderer shell' );
		await expect(
			fetch( `${ server.origin }/app.js` ).then( ( response ) => response.text() )
		).resolves.toBe( 'renderer asset' );
		await expect( fetch( `${ server.origin }/wp-admin/` ) ).resolves.toMatchObject( {
			status: 404,
		} );
		await expect( fetch( `${ server.origin }/phpmyadmin/` ) ).resolves.toMatchObject( {
			status: 404,
		} );
	} );
} );
