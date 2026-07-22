import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalConnector } from './index';

describe( 'createLocalConnector Connect contracts', () => {
	const fetchMock = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	} );

	it( 'forwards skipStart and uses explicit all-sites endpoints', async () => {
		fetchMock.mockImplementation( async ( input: string | URL | Request ) => {
			const url = String( input );
			if ( url.endsWith( '/api/sites' ) ) {
				return new Response( JSON.stringify( { id: 'site-1' } ) );
			}
			return new Response( JSON.stringify( [] ) );
		} );
		const connector = createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );

		await connector.createSite( {
			name: 'Remote site',
			path: '/sites/remote-site',
			skipStart: true,
		} );
		await connector.fetchAllWpcomSites();
		await connector.getAllConnectedWpcomSites();

		const createCall = fetchMock.mock.calls[ 0 ];
		expect( JSON.parse( String( createCall[ 1 ]?.body ) ) ).toMatchObject( { skipStart: true } );
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/wpcom/sites',
			expect.any( Object )
		);
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/wpcom/connected-sites',
			expect.any( Object )
		);
	} );

	it( 'requests the signup-aware login URL', async () => {
		fetchMock.mockResolvedValue(
			new Response( JSON.stringify( { url: 'https://wordpress.com/start' } ) )
		);
		const popup = {
			closed: false,
			close: vi.fn(),
			location: { href: '' },
		};
		vi.spyOn( window, 'open' ).mockReturnValue( popup as unknown as Window );
		const connector = createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );

		const authenticating = connector.authenticate( true );
		await vi.waitFor( () => expect( popup.location.href ).toBe( 'https://wordpress.com/start' ) );
		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: window.location.origin,
				data: { type: 'studio-auth-success' },
			} )
		);
		await authenticating;

		expect( String( fetchMock.mock.calls[ 0 ][ 0 ] ) ).toContain( '&signup=1' );
		expect( popup.location.href ).toBe( 'https://wordpress.com/start' );
	} );

	it( 'forwards matching pull progress from the local server event stream', async () => {
		let onMessage: ( ( event: MessageEvent ) => void ) | null = null;
		class MockEventSource {
			set onmessage( listener: ( ( event: MessageEvent ) => void ) | null ) {
				onMessage = listener;
			}

			close() {}
		}
		vi.stubGlobal( 'EventSource', MockEventSource );
		vi.stubGlobal( 'crypto', { randomUUID: () => 'pull-operation' } );
		fetchMock.mockImplementation( async ( _input: string | URL | Request, init?: RequestInit ) => {
			const { operationId } = JSON.parse( String( init?.body ) ) as { operationId: string };
			onMessage?.(
				new MessageEvent( 'message', {
					data: JSON.stringify( {
						channel: 'sync-pull',
						payload: {
							operationId,
							siteId: 'site-1',
							remoteSiteId: 42,
							message: 'Creating remote backup… (20%)',
							progress: 20,
						},
					} ),
				} )
			);
			return new Response( null, { status: 204 } );
		} );
		const connector = createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );
		const onProgress = vi.fn();
		await connector.init?.();

		await connector.pullSiteFromLive( 'site-1', 42, onProgress );

		expect( onProgress ).toHaveBeenCalledWith( {
			message: 'Creating remote backup… (20%)',
			progress: 20,
		} );
	} );
} );
