import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
	it( 'isolates the renderer shell from the synthetic browser-preview page', async () => {
		temporaryDirectory = await mkdtemp( path.join( os.tmpdir(), 'studio-marketing-server-' ) );
		const previewDirectory = path.join( temporaryDirectory, 'marketing-preview', 'meridian' );
		await mkdir( previewDirectory, { recursive: true } );
		await Promise.all( [
			writeFile( path.join( temporaryDirectory, 'index.marketing.html' ), 'renderer shell' ),
			writeFile( path.join( previewDirectory, 'index.html' ), 'Meridian frontend' ),
		] );
		server = await startStaticServer( temporaryDirectory );

		await expect( fetch( server.origin ).then( ( response ) => response.text() ) ).resolves.toBe(
			'renderer shell'
		);
		await expect(
			fetch( server.origin, { headers: { 'sec-fetch-dest': 'iframe' } } ).then( ( response ) =>
				response.text()
			)
		).resolves.toBe( 'Meridian frontend' );
		await expect( fetch( `${ server.origin }/wp-admin/` ) ).resolves.toMatchObject( {
			status: 404,
		} );
		await expect( fetch( `${ server.origin }/phpmyadmin/` ) ).resolves.toMatchObject( {
			status: 404,
		} );
	} );
} );
