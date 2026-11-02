import { once } from 'node:events';
import http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { shouldUsePrimaryWorker, waitForServerReady } from 'cli/php-server-child';
import type { AddressInfo } from 'node:net';

const { restoreProcessWiring } = vi.hoisted( () => {
	type Listener = ( ...args: unknown[] ) => void;
	const p = process as unknown as {
		listeners( event: string ): Listener[];
		off( event: string, listener: Listener ): unknown;
		send?: unknown;
	};
	const events = [ 'message', 'disconnect', 'SIGTERM', 'SIGINT', 'exit' ];
	const originalListeners = new Map( events.map( ( event ) => [ event, p.listeners( event ) ] ) );
	const originalSend = p.send;
	// php-server-child throws at import time without an IPC channel; give it a
	// no-op so the module loads inside the test runner.
	p.send = () => {};
	return {
		restoreProcessWiring() {
			p.send = originalSend;
			for ( const event of events ) {
				for ( const listener of p.listeners( event ) ) {
					if ( ! originalListeners.get( event )?.includes( listener ) ) {
						p.off( event, listener );
					}
				}
			}
		},
	};
} );

// Undo php-server-child's import-time wiring (IPC handler, signal handlers) so
// it does not talk to the test runner's channel or log while the worker tears
// down. vi.hoisted runs before the imports above, so this sees exactly what the
// module added.
restoreProcessWiring();

function makeRequest( method: string, url: string ): http.IncomingMessage {
	return { method, url } as http.IncomingMessage;
}

describe( 'PHP worker routing', () => {
	it( 'does not pin WordPress admin-ajax POSTs to the primary worker', () => {
		expect( shouldUsePrimaryWorker( makeRequest( 'POST', '/wp-admin/admin-ajax.php' ) ) ).toBe(
			false
		);
	} );

	it( 'does not pin wp-cron POSTs to the primary worker', () => {
		expect( shouldUsePrimaryWorker( makeRequest( 'POST', '/wp-cron.php' ) ) ).toBe( false );
	} );

	it( 'pins phpMyAdmin requests to the primary worker regardless of method', () => {
		expect( shouldUsePrimaryWorker( makeRequest( 'GET', '/phpmyadmin/index.php' ) ) ).toBe( true );
		expect( shouldUsePrimaryWorker( makeRequest( 'POST', '/phpmyadmin/index.php' ) ) ).toBe( true );
	} );

	it( 'does not pin the site root to the primary worker', () => {
		expect( shouldUsePrimaryWorker( makeRequest( 'GET', '/' ) ) ).toBe( false );
	} );
} );

describe( 'waitForServerReady', () => {
	it( 'drops the response instead of leaving its body unread', async () => {
		const server = http.createServer( ( req, res ) => res.write( 'partial body' ) );
		const connectionClosed = once( server, 'request' ).then( ( [ , res ] ) =>
			once( res, 'close' )
		);
		server.listen( 0, '127.0.0.1' );
		await once( server, 'listening' );

		const { port } = server.address() as AddressInfo;
		await waitForServerReady( `http://127.0.0.1:${ port }/` );

		await connectionClosed;
		server.close();
	} );
} );
