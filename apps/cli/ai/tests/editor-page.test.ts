import { existsSync } from 'fs';
import http from 'http';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EditorPage, closeSharedBrowser } from 'cli/ai/browser-utils';
import type { AddressInfo } from 'net';

// A real Chromium to load pages with, when one is installed.
const CHROMIUM = existsSync( chromium.executablePath() );

// The block editor, as far as EditorPage waits for it.
const EDITOR = `<script>window.wp = { blocks: { getBlockTypes: () => [ { name: 'core/paragraph' } ] } };</script>`;

describe.runIf( CHROMIUM )( 'loading the block editor', () => {
	let server: http.Server;
	let siteUrl: string;
	// Whether the next admin page redirects once, as a plugin's setup wizard does after activation.
	let redirectOnce = false;
	beforeAll( async () => {
		server = http.createServer( ( request, response ) => {
			const url = new URL( request.url ?? '/', 'http://localhost' );
			if ( url.pathname === '/studio-auto-login' ) {
				response.writeHead( 302, { location: url.searchParams.get( 'redirect_to' ) ?? '/' } );
			} else if ( url.pathname === '/wp-admin/post-new.php' && redirectOnce ) {
				redirectOnce = false;
				response.writeHead( 302, { location: '/wp-admin/admin.php?page=wc-admin' } );
			} else if ( url.pathname === '/wp-admin/post-new.php' ) {
				response.writeHead( 200, { 'content-type': 'text/html' } );
				response.write( EDITOR );
			} else {
				response.writeHead( 200, { 'content-type': 'text/html' } );
				response.write( '<p>Welcome to the setup wizard</p>' );
			}
			response.end();
		} );
		await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		siteUrl = `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }`;
	} );
	afterAll( async () => {
		await closeSharedBrowser();
		server.close();
	} );

	it.each( [
		{ name: 'straight after login', redirect: false },
		{ name: 'when a plugin sends the first admin page elsewhere once', redirect: true },
	] )(
		'loads it $name',
		async ( { redirect } ) => {
			redirectOnce = redirect;
			const editor = new EditorPage( siteUrl );
			const page = await editor.getPage();
			expect( new URL( page.url() ).pathname ).toBe( '/wp-admin/post-new.php' );
			await editor.close();
		},
		60000
	);
} );
