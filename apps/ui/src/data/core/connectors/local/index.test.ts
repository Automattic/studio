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

	it( 'forwards skipStart and requests site and connection sets', async () => {
		fetchMock.mockImplementation( async ( input: string | URL | Request ) => {
			const url = String( input );
			if ( url.endsWith( '/api/sites' ) ) {
				return new Response( JSON.stringify( { id: 'site-1' } ) );
			}
			if ( url.includes( '/api/site-defaults/name?base=' ) ) {
				return new Response( JSON.stringify( { name: 'Remote site 2' } ) );
			}
			return new Response( JSON.stringify( [] ) );
		} );
		const connector = createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );

		await connector.createSite( {
			name: 'Remote site',
			path: '/sites/remote-site',
			skipStart: true,
		} );
		await connector.fetchSyncableWpcomSites();
		await connector.getConnectedWpcomSites();
		await expect( connector.generateNumberedSiteName( 'Remote site', [] ) ).resolves.toBe(
			'Remote site 2'
		);

		const createCall = fetchMock.mock.calls[ 0 ];
		expect( JSON.parse( String( createCall[ 1 ]?.body ) ) ).toMatchObject( { skipStart: true } );
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/wpcom/syncable-sites',
			expect.any( Object )
		);
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/wpcom/connected-sites',
			expect.any( Object )
		);
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/site-defaults/name?base=Remote%20site',
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
		fetchMock.mockImplementation( async () => {
			onMessage?.(
				new MessageEvent( 'message', {
					data: JSON.stringify( {
						channel: 'sync-pull',
						payload: {
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
