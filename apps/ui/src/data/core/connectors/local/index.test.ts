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

	it( 'reads global preferences from the server, not the browser', async () => {
		fetchMock.mockResolvedValue( new Response( JSON.stringify( { editor: 'vscode' } ) ) );
		const connector = createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );

		// The CLI-install fields are desktop-only, so the connector supplies them.
		await expect( connector.getUserPreferences() ).resolves.toEqual( {
			editor: 'vscode',
			studioCliInstalled: false,
			studioCliExternallyManaged: false,
		} );
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/user-preferences',
			expect.any( Object )
		);
	} );

	it( 'sends cleared preferences as null so the server can unset them', async () => {
		fetchMock.mockResolvedValue( new Response( null, { status: 204 } ) );
		const connector = createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );

		await connector.setUserPreferences( { editor: null, quitSitesBehavior: undefined } );

		const [ url, init ] = fetchMock.mock.calls[ 0 ];
		expect( String( url ) ).toBe( 'http://localhost:8081/api/user-preferences' );
		expect( init?.method ).toBe( 'PATCH' );
		expect( JSON.parse( String( init?.body ) ) ).toEqual( {
			editor: null,
			quitSitesBehavior: null,
		} );
	} );

	it( 'persists the manual site order on the server', async () => {
		fetchMock.mockResolvedValue( new Response( null, { status: 204 } ) );
		const connector = createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );

		await connector.updateSitesSortOrder( [ { siteId: 'site-1', sortOrder: 1000 } ] );

		const [ url, init ] = fetchMock.mock.calls[ 0 ];
		expect( String( url ) ).toBe( 'http://localhost:8081/api/sites/sort-order' );
		expect( JSON.parse( String( init?.body ) ) ).toEqual( {
			updates: [ { siteId: 'site-1', sortOrder: 1000 } ],
		} );
	} );

	it( 'loads theme details from the local server', async () => {
		const theme = {
			name: 'Twenty Twenty-Five',
			path: '/sites/site-1/wp-content/themes/twentytwentyfive',
			slug: 'twentytwentyfive',
			isBlockTheme: true,
		};
		fetchMock.mockResolvedValue( new Response( JSON.stringify( theme ) ) );
		const connector = createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );

		await expect( connector.getThemeDetails?.( 'site-1' ) ).resolves.toEqual( theme );
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/sites/site-1/theme',
			expect.any( Object )
		);
	} );

	it( 'loads the cached site thumbnail as a data URL', async () => {
		fetchMock.mockResolvedValue(
			new Response( new Uint8Array( [ 1, 2, 3 ] ), { headers: { 'Content-Type': 'image/png' } } )
		);
		const connector = createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );

		await expect( connector.getSiteThumbnail( 'site-1' ) ).resolves.toBe(
			'data:image/png;base64,AQID'
		);
		expect( fetchMock ).toHaveBeenCalledWith( 'http://localhost:8081/api/sites/site-1/thumbnail' );
	} );

	it( 'treats a missing cached thumbnail as an empty thumbnail', async () => {
		fetchMock.mockResolvedValue( new Response( null, { status: 404 } ) );
		const connector = createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );

		await expect( connector.getSiteThumbnail( 'site-1' ) ).resolves.toBeNull();
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

// Missing routes make `api()` throw and the button silently never appear, so
// pin the exact URLs.
describe( 'createLocalConnector debug log', () => {
	const fetchMock = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	} );

	it( 'unwraps the existence check', async () => {
		fetchMock.mockResolvedValue( new Response( JSON.stringify( { exists: true } ) ) );
		const connector = createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );

		await expect( connector.siteDebugLogExists( 'site-1' ) ).resolves.toBe( true );
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/sites/site-1/debug-log',
			expect.any( Object )
		);
	} );

	it( 'asks the server to open the log', async () => {
		fetchMock.mockResolvedValue( new Response( null, { status: 204 } ) );
		const connector = createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );

		await connector.openSiteDebugLog( 'site-1' );

		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/sites/site-1/debug-log/open',
			expect.objectContaining( { method: 'POST' } )
		);
	} );
} );
