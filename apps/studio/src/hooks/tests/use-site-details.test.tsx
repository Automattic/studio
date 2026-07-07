// To run tests, execute `npm run test -- src/hooks/tests/use-site-details.test.ts` from the root directory
import { renderHook, waitFor, act } from '@testing-library/react';
import { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { vi, beforeAll } from 'vitest';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { SiteDetailsProvider, useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';

vi.mock( 'src/lib/get-ipc-api' );

const mockSites: SiteDetails[] = [
	{
		id: 'site-1',
		name: 'Site 1',
		path: '/path/to/site1',
		port: 1234,
		phpVersion: '8.4',
		running: false as const,
		autoStart: true,
		themeDetails: undefined,
	},
	{
		id: 'site-2',
		name: 'Site 2',
		path: '/path/to/site2',
		port: 1235,
		phpVersion: '8.4',
		running: false as const,
		autoStart: false,
		themeDetails: undefined,
	},
	{
		id: 'site-3',
		name: 'Site 3',
		path: '/path/to/site3',
		port: 1236,
		phpVersion: '8.4',
		running: false as const,
		autoStart: true,
		themeDetails: undefined,
	},
];

const wrapper = ( { children }: { children: ReactNode } ) => (
	<Provider store={ store }>
		<ContentTabsProvider>
			<SiteDetailsProvider>{ children }</SiteDetailsProvider>
		</ContentTabsProvider>
	</Provider>
);

describe( 'useSiteDetails', () => {
	beforeAll( () => {
		Object.defineProperty( window, 'ipcListener', {
			value: {
				subscribe: vi.fn().mockReturnValue( () => {} ),
			},
			writable: true,
		} );
	} );

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			getSiteDetails: vi.fn().mockResolvedValue( mockSites ),
			startServer: vi.fn( () => Promise.resolve() ),
			deleteSite: vi.fn( () => Promise.resolve() ),
			getConnectedWpcomSites: vi.fn( () => Promise.resolve( [] ) ),
		} );
	} );

	describe( 'autoStart functionality', () => {
		it( 'should auto-start sites with autoStart flag set to true', async () => {
			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			// Verify that startServer was called for the sites with autoStart: true
			expect( getIpcApi().startServer ).toHaveBeenCalledWith( 'site-1' );
			expect( getIpcApi().startServer ).not.toHaveBeenCalledWith( 'site-2' );
			expect( getIpcApi().startServer ).toHaveBeenCalledWith( 'site-3' );
		} );

		it( 'should not auto-start sites if autoStart flag is false', async () => {
			vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
				getSiteDetails: vi.fn().mockResolvedValue(
					mockSites.map( ( site ) => ( {
						...site,
						autoStart: false,
					} ) )
				),
				startServer: vi.fn( () => Promise.resolve() ),
			} );

			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			// Verify that startServer was not called for any site
			expect( getIpcApi().startServer ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'startAllStoppedSites', () => {
		it( 'should start all stopped sites', async () => {
			const sitesWithMixedState = [
				{
					...mockSites[ 0 ],
					running: true as const,
					autoStart: false,
					url: 'http://localhost:1234',
				},
				{ ...mockSites[ 1 ], running: false as const, autoStart: false },
				{ ...mockSites[ 2 ], running: false as const, autoStart: false },
			];
			vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
				getSiteDetails: vi.fn().mockResolvedValue( sitesWithMixedState ),
				startServer: vi.fn( () => Promise.resolve() ),
			} );

			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			vi.mocked( getIpcApi().startServer ).mockClear();

			await act( async () => {
				await result.current.startAllStoppedSites();
			} );

			expect( getIpcApi().startServer ).toHaveBeenCalledWith( 'site-2' );
			expect( getIpcApi().startServer ).toHaveBeenCalledWith( 'site-3' );
			expect( getIpcApi().startServer ).not.toHaveBeenCalledWith( 'site-1' );
		} );

		it( 'should not start sites that are being added', async () => {
			const sitesWithAdding = [
				{ ...mockSites[ 0 ], running: false as const, autoStart: false },
				{ ...mockSites[ 1 ], running: false as const, autoStart: false, isAddingSite: true },
			];
			vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
				getSiteDetails: vi.fn().mockResolvedValue( sitesWithAdding ),
				startServer: vi.fn( () => Promise.resolve() ),
			} );

			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			vi.mocked( getIpcApi().startServer ).mockClear();

			await act( async () => {
				await result.current.startAllStoppedSites();
			} );

			expect( getIpcApi().startServer ).toHaveBeenCalledWith( 'site-1' );
			expect( getIpcApi().startServer ).not.toHaveBeenCalledWith( 'site-2' );
		} );
	} );

	describe( 'startServer error handling', () => {
		function setupStartServerError( error: Error ) {
			const showErrorMessageBox = vi.fn();
			const stopServer = vi.fn( () => Promise.resolve() );
			vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
				getSiteDetails: vi.fn().mockResolvedValue( mockSites ),
				startServer: vi.fn().mockRejectedValue( error ),
				showErrorMessageBox,
				stopServer,
				getConnectedWpcomSites: vi.fn( () => Promise.resolve( [] ) ),
			} );
			return { showErrorMessageBox, stopServer };
		}

		it( 'should include site name in error title for generic start failure', async () => {
			const { showErrorMessageBox } = setupStartServerError( new Error( 'Something went wrong' ) );

			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			vi.mocked( getIpcApi().startServer ).mockClear();

			await act( async () => {
				await result.current.startServer( mockSites[ 1 ] );
			} );

			expect( showErrorMessageBox ).toHaveBeenCalledWith(
				expect.objectContaining( {
					title: "Failed to start 'Site 2'",
				} )
			);
		} );

		it( 'should include site name in error title for WASM memory error', async () => {
			const { showErrorMessageBox } = setupStartServerError(
				new Error( 'WASM_ERROR_NOT_ENOUGH_MEMORY' )
			);

			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			vi.mocked( getIpcApi().startServer ).mockClear();

			await act( async () => {
				await result.current.startServer( mockSites[ 0 ] as SiteDetails );
			} );

			expect( showErrorMessageBox ).toHaveBeenCalledWith(
				expect.objectContaining( {
					title: "Not enough memory to start 'Site 1'",
				} )
			);
		} );

		it( 'should include site name in error title for port-in-use error', async () => {
			const { showErrorMessageBox } = setupStartServerError(
				new Error( 'ERROR_PORT_IN_USE 8080' )
			);

			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			vi.mocked( getIpcApi().startServer ).mockClear();

			await act( async () => {
				await result.current.startServer( mockSites[ 2 ] as SiteDetails );
			} );

			expect( showErrorMessageBox ).toHaveBeenCalledWith(
				expect.objectContaining( {
					title: "Failed to start 'Site 3'",
				} )
			);
		} );

		it( 'should include site name in error title for proxy port-in-use error', async () => {
			const { showErrorMessageBox } = setupStartServerError(
				new Error( 'PROXY_ERROR_PORT_IN_USE' )
			);

			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			vi.mocked( getIpcApi().startServer ).mockClear();

			await act( async () => {
				await result.current.startServer( mockSites[ 0 ] as SiteDetails );
			} );

			expect( showErrorMessageBox ).toHaveBeenCalledWith(
				expect.objectContaining( {
					title: "Failed to initialize custom domains for 'Site 1'",
				} )
			);
		} );

		it( 'should include site name in error title for proxy start failed error', async () => {
			const { showErrorMessageBox } = setupStartServerError(
				new Error( 'PROXY_ERROR_START_FAILED' )
			);

			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			vi.mocked( getIpcApi().startServer ).mockClear();

			await act( async () => {
				await result.current.startServer( mockSites[ 1 ] as SiteDetails );
			} );

			expect( showErrorMessageBox ).toHaveBeenCalledWith(
				expect.objectContaining( {
					title: "Failed to initialize custom domains for 'Site 2'",
				} )
			);
		} );

		it( 'should use site name in dialog title even if site has no name', async () => {
			const { showErrorMessageBox } = setupStartServerError( new Error( 'Something went wrong' ) );

			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			vi.mocked( getIpcApi().startServer ).mockClear();

			await act( async () => {
				await result.current.startServer( {
					id: 'non-existent-id',
					name: '',
					path: '',
					port: 0,
					phpVersion: '',
					running: false,
				} );
			} );

			expect( showErrorMessageBox ).toHaveBeenCalledWith(
				expect.objectContaining( {
					title: "Failed to start ''",
				} )
			);
		} );

		it( 'should show capacity limit error and return capacityLimitReached', async () => {
			const { showErrorMessageBox } = setupStartServerError(
				new Error( 'CAPACITY_LIMIT_REACHED' )
			);

			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			vi.mocked( getIpcApi().startServer ).mockClear();

			let startResult: { capacityLimitReached: boolean } | undefined;
			await act( async () => {
				startResult = await result.current.startServer( mockSites[ 0 ] as SiteDetails );
			} );

			expect( startResult?.capacityLimitReached ).toBe( true );
			expect( showErrorMessageBox ).toHaveBeenCalledWith(
				expect.objectContaining( {
					title: "Failed to start 'Site 1'",
					message: expect.stringContaining( 'maximum number of running sites' ),
				} )
			);
		} );
	} );

	describe( 'autoStart shows single error on capacity limit', () => {
		it( 'should start all sites in parallel and show a single error when capacity limit is reached', async () => {
			const autoStartSites = [
				{ ...mockSites[ 0 ], autoStart: true },
				{ ...mockSites[ 1 ], autoStart: true },
				{ ...mockSites[ 2 ], autoStart: true },
			];

			const startServer = vi
				.fn()
				.mockResolvedValueOnce( undefined )
				.mockRejectedValueOnce( new Error( 'CAPACITY_LIMIT_REACHED' ) )
				.mockResolvedValueOnce( undefined );

			const showErrorMessageBox = vi.fn();
			const stopServer = vi.fn( () => Promise.resolve() );

			vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
				getSiteDetails: vi.fn().mockResolvedValue( autoStartSites ),
				startServer,
				showErrorMessageBox,
				stopServer,
				getConnectedWpcomSites: vi.fn( () => Promise.resolve( [] ) ),
			} );

			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			// Wait for parallel autoStart to complete
			await waitFor( () => {
				// All sites are attempted in parallel
				expect( startServer ).toHaveBeenCalledWith( 'site-1' );
				expect( startServer ).toHaveBeenCalledWith( 'site-2' );
				expect( startServer ).toHaveBeenCalledWith( 'site-3' );
				// A single consolidated error modal is shown
				expect( showErrorMessageBox ).toHaveBeenCalledTimes( 1 );
				expect( showErrorMessageBox ).toHaveBeenCalledWith(
					expect.objectContaining( {
						message: expect.stringContaining( 'maximum number of running sites' ),
					} )
				);
			} );
		} );
	} );

	describe( 'site deletion selection behavior', () => {
		it( 'should select first site when deleting the currently selected site', async () => {
			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			// Select site-3 (the site we'll delete)
			act( () => {
				result.current.setSelectedSiteId( 'site-3' );
			} );

			await waitFor( () => {
				expect( result.current.selectedSite?.id ).toBe( 'site-3' );
			} );

			// Simulate that after deletion, site-3 is removed
			const sitesAfterDeletion = mockSites.filter( ( site ) => site.id !== 'site-3' );
			vi.mocked( getIpcApi().getSiteDetails ).mockResolvedValueOnce( sitesAfterDeletion );

			// Delete site-3
			await act( async () => {
				await result.current.deleteSite( 'site-3', false );
			} );

			// Should select the first remaining site since the selected site was deleted
			await waitFor( () => {
				expect( result.current.selectedSite?.id ).toBe( 'site-1' );
			} );
		} );

		it( 'should preserve selection when deleting a different site', async () => {
			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			// Select site-2 (NOT the site we'll delete)
			act( () => {
				result.current.setSelectedSiteId( 'site-2' );
			} );

			await waitFor( () => {
				expect( result.current.selectedSite?.id ).toBe( 'site-2' );
			} );

			// Simulate that after deletion, site-3 is removed (but site-2 still exists)
			const sitesAfterDeletion = mockSites.filter( ( site ) => site.id !== 'site-3' );
			vi.mocked( getIpcApi().getSiteDetails ).mockResolvedValueOnce( sitesAfterDeletion );

			// Delete site-3 (not the selected site)
			await act( async () => {
				await result.current.deleteSite( 'site-3', false );
			} );

			// Selection should stay on site-2 since it still exists
			await waitFor( () => {
				expect( result.current.selectedSite?.id ).toBe( 'site-2' );
			} );
		} );
	} );
} );
