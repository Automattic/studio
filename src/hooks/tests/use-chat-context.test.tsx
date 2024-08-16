import { renderHook, act } from '@testing-library/react';
import { getIpcApi } from '../../lib/get-ipc-api';
import { ChatProvider, useChatContext } from '../use-chat-context';
import { useCheckInstalledApps } from '../use-check-installed-apps';
import { useGetWpVersion } from '../use-get-wp-version';
import { useSiteDetails } from '../use-site-details';
import { useThemeDetails } from '../use-theme-details';
import { useWindowListener } from '../use-window-listener';

jest.mock( '../../lib/get-ipc-api' );
jest.mock( '../use-site-details' );
jest.mock( '../use-check-installed-apps' );
jest.mock( '../use-get-wp-version' );
jest.mock( '../use-theme-details' );
jest.mock( '../use-window-listener' );

const SELECTED_SITE: SiteDetails = {
	id: 'site-id-1',
	name: 'Test Site',
	running: false,
	path: '/test-site',
	phpVersion: '8.0',
	adminPassword: btoa( 'test-password' ),
	port: 8881,
};

const wrapper = ( { children }: { children: React.ReactNode } ) => (
	<ChatProvider>{ children }</ChatProvider>
);

const setupWpCliResult = ( { themes, plugins }: { themes: string[]; plugins: string[] } ) => {
	( getIpcApi().executeWPCLiInline as jest.Mock ).mockImplementation(
		( { args }: { args: string } ) => {
			if ( args.startsWith( 'theme list' ) ) {
				return Promise.resolve( {
					stdout: JSON.stringify( themes.map( ( name ) => ( { name } ) ) ),
					stderr: '',
				} );
			} else if ( args.startsWith( 'plugin list' ) ) {
				return Promise.resolve( {
					stdout: JSON.stringify( plugins.map( ( name ) => ( { name } ) ) ),
					stderr: '',
				} );
			}
			return Promise.reject();
		}
	);
};

beforeEach( () => {
	jest.clearAllMocks();
	jest.useFakeTimers();

	( getIpcApi as jest.Mock ).mockReturnValue( {
		executeWPCLiInline: jest.fn(),
	} );
	( useCheckInstalledApps as jest.Mock ).mockReturnValue( [] );
	( useSiteDetails as jest.Mock ).mockReturnValue( {
		data: [ SELECTED_SITE ],
		loadingSites: false,
		selectedSite: SELECTED_SITE,
	} );
	( useGetWpVersion as jest.Mock ).mockReturnValue( '6.6.2' );
	( useThemeDetails as jest.Mock ).mockReturnValue( {
		selectedThemeDetails: {
			name: 'theme-1',
			isBlockTheme: true,
		},
	} );
	( useWindowListener as jest.Mock ).mockReturnValue( jest.fn() );
	window.appGlobals = window.appGlobals ?? {};
	jest.replaceProperty( window, 'appGlobals', {
		platform: 'darwin',
		locale: 'en',
		localeData: undefined,
		appName: '',
		arm64Translation: false,
		assistantEnabled: false,
		terminalWpCliEnabled: false,
		importExportEnabled: false,
	} );
	setupWpCliResult( { themes: [], plugins: [] } );
} );

afterEach( () => {
	jest.useRealTimers();
} );

describe( 'useChatContext hook', () => {
	describe( 'on initial load', () => {
		it( 'returns context of selected site', async () => {
			const { result } = renderHook( () => useChatContext(), { wrapper } );

			// Flush all pending promises of WP-CLI command
			await act( () => jest.runOnlyPendingTimersAsync() );

			expect( result.current ).toEqual( {
				numberOfSites: 1,
				themeList: [],
				pluginList: [],
				wpVersion: '6.6.2',
				phpVersion: '8.0',
				currentURL: 'http://localhost:8881',
				themeName: 'theme-1',
				isBlockTheme: true,
				availableEditors: [],
				siteName: 'Test Site',
				os: 'darwin',
			} );
		} );

		it( 'fetches plugins and themes of selected site ', async () => {
			setupWpCliResult( { themes: [ 'theme-1', 'theme-2' ], plugins: [ 'plugin-1' ] } );

			const { result } = renderHook( () => useChatContext(), { wrapper } );

			// Flush all pending promises of WP-CLI command
			await act( () => jest.runOnlyPendingTimersAsync() );

			expect( result.current ).toEqual(
				expect.objectContaining( {
					themeList: [ 'theme-1', 'theme-2' ],
					pluginList: [ 'plugin-1' ],
					siteName: 'Test Site',
				} )
			);
			expect( getIpcApi().executeWPCLiInline ).toHaveBeenNthCalledWith( 1, {
				siteId: SELECTED_SITE.id,
				args: 'plugin list --format=json --status=active',
			} );
			expect( getIpcApi().executeWPCLiInline ).toHaveBeenNthCalledWith( 2, {
				siteId: SELECTED_SITE.id,
				args: 'theme list --format=json',
			} );
			expect( getIpcApi().executeWPCLiInline ).toHaveBeenCalledTimes( 2 );
		} );

		it( 'does not fetch plugins and themes if sites are loading', async () => {
			( useSiteDetails as jest.Mock ).mockReturnValue( {
				data: [ SELECTED_SITE ],
				loadingSites: true,
				selectedSite: SELECTED_SITE,
			} );

			renderHook( () => useChatContext(), { wrapper } );

			expect( getIpcApi().executeWPCLiInline ).not.toHaveBeenCalled();
		} );

		it( 'does not fetch plugins and themes if site is being added', async () => {
			( useSiteDetails as jest.Mock ).mockReturnValue( {
				data: [ SELECTED_SITE ],
				loadingSites: false,
				selectedSite: { ...SELECTED_SITE, isAddingSite: true },
			} );

			renderHook( () => useChatContext(), { wrapper } );

			expect( getIpcApi().executeWPCLiInline ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'when selecting a site', () => {
		const ANOTHER_SITE = {
			...SELECTED_SITE,
			id: 'another-site',
			name: 'Another Test Site',
			path: '/another-test-site',
			port: 8882,
		};
		const ALL_SITES = [ SELECTED_SITE, ANOTHER_SITE ];

		const selectSite = ( siteId: string ) => {
			( useSiteDetails as jest.Mock ).mockReturnValue( {
				data: ALL_SITES,
				loadingSites: false,
				selectedSite: ALL_SITES.find( ( site ) => site.id === siteId ),
			} );
		};

		beforeEach( () => {
			selectSite( 'site-id-1' );
		} );

		it( 'returns context of selected site', async () => {
			const { result, rerender } = renderHook( () => useChatContext(), { wrapper } );

			expect( result.current ).toEqual(
				expect.objectContaining( {
					numberOfSites: 2,
					themeList: [],
					pluginList: [],
					siteName: 'Test Site',
				} )
			);

			setupWpCliResult( { themes: [ 'theme-1' ], plugins: [ 'plugin-1' ] } );
			selectSite( 'another-site' );
			rerender();
			// Flush all pending promises of WP-CLI command
			await act( () => jest.runOnlyPendingTimersAsync() );

			expect( result.current ).toEqual( {
				numberOfSites: 2,
				themeList: [ 'theme-1' ],
				pluginList: [ 'plugin-1' ],
				wpVersion: '6.6.2',
				phpVersion: '8.0',
				currentURL: 'http://localhost:8882',
				themeName: 'theme-1',
				isBlockTheme: true,
				availableEditors: [],
				siteName: 'Another Test Site',
				os: 'darwin',
			} );
		} );

		it( 'fetches plugins and themes of selected site', async () => {
			const { result, rerender } = renderHook( () => useChatContext(), { wrapper } );

			// Reset initial WP-CLI command calls
			( getIpcApi().executeWPCLiInline as jest.Mock ).mockClear();

			setupWpCliResult( { themes: [ 'theme-1' ], plugins: [ 'plugin-1' ] } );
			selectSite( 'another-site' );
			rerender();
			// Flush all pending promises of WP-CLI command
			await act( () => jest.runOnlyPendingTimersAsync() );

			expect( result.current ).toEqual(
				expect.objectContaining( {
					themeList: [ 'theme-1' ],
					pluginList: [ 'plugin-1' ],
					siteName: 'Another Test Site',
				} )
			);

			expect( getIpcApi().executeWPCLiInline ).toHaveBeenNthCalledWith( 1, {
				siteId: ANOTHER_SITE.id,
				args: 'plugin list --format=json --status=active',
			} );
			expect( getIpcApi().executeWPCLiInline ).toHaveBeenNthCalledWith( 2, {
				siteId: ANOTHER_SITE.id,
				args: 'theme list --format=json',
			} );
			expect( getIpcApi().executeWPCLiInline ).toHaveBeenCalledTimes( 2 );
		} );

		it( 'does not fetch plugins and themes if data was already fetched', async () => {
			const { rerender } = renderHook( () => useChatContext(), { wrapper } );

			selectSite( 'another-site' );
			rerender();

			// Reset initial WP-CLI command calls
			( getIpcApi().executeWPCLiInline as jest.Mock ).mockClear();

			// Selecting the first site again shouldn't fetch plugins and themes
			selectSite( 'site-id-1' );
			rerender();
			// Flush all pending promises of WP-CLI command
			await act( () => jest.runOnlyPendingTimersAsync() );

			expect( getIpcApi().executeWPCLiInline ).not.toHaveBeenCalled();
		} );

		it( 'fetch plugins and themes again if failed first time ', async () => {
			// Force WP-CLI commands to fail
			( getIpcApi().executeWPCLiInline as jest.Mock ).mockRejectedValue( {} );

			const { rerender } = renderHook( () => useChatContext(), { wrapper } );
			// Flush all pending promises of WP-CLI command
			await act( () => jest.runOnlyPendingTimersAsync() );

			expect( getIpcApi().executeWPCLiInline ).toHaveBeenCalledTimes( 2 );

			// Restore WP-CLI commands
			setupWpCliResult( { themes: [], plugins: [] } );
			selectSite( 'another-site' );
			rerender();

			// Reset initial WP-CLI command calls
			( getIpcApi().executeWPCLiInline as jest.Mock ).mockClear();

			// Selecting the first site again should fetch plugins and themes
			// as it failed the first time.
			selectSite( 'site-id-1' );
			rerender();
			// Flush all pending promises of WP-CLI command
			await act( () => jest.runOnlyPendingTimersAsync() );

			expect( getIpcApi().executeWPCLiInline ).toHaveBeenNthCalledWith( 1, {
				siteId: SELECTED_SITE.id,
				args: 'plugin list --format=json --status=active',
			} );
			expect( getIpcApi().executeWPCLiInline ).toHaveBeenNthCalledWith( 2, {
				siteId: SELECTED_SITE.id,
				args: 'theme list --format=json',
			} );
			expect( getIpcApi().executeWPCLiInline ).toHaveBeenCalledTimes( 2 );
		} );
	} );

	describe( 'when creating a site', () => {
		const NEW_SITE = {
			...SELECTED_SITE,
			id: 'new-site-id',
			name: 'New Test Site',
			path: '/new-test-site',
		};

		const startSiteCreation = ( site: SiteDetails ) => {
			( useSiteDetails as jest.Mock ).mockReturnValue( {
				data: [ SELECTED_SITE, site ],
				loadingSites: false,
				selectedSite: { ...site, isAddingSite: true },
			} );
		};

		const finishSiteCreation = ( site: SiteDetails ) => {
			( useSiteDetails as jest.Mock ).mockReturnValue( {
				data: [ SELECTED_SITE, site ],
				loadingSites: false,
				selectedSite: { ...site, isAddingSite: false },
			} );
		};

		beforeEach( () => {
			( useSiteDetails as jest.Mock ).mockReturnValue( {
				data: [ SELECTED_SITE ],
				loadingSites: false,
				selectedSite: SELECTED_SITE,
			} );
		} );

		it( 'returns context of new site', async () => {
			const { result, rerender } = renderHook( () => useChatContext(), { wrapper } );

			expect( result.current ).toEqual(
				expect.objectContaining( {
					numberOfSites: 1,
					themeList: [],
					pluginList: [],
					siteName: 'Test Site',
				} )
			);

			setupWpCliResult( { themes: [ 'theme-1' ], plugins: [ 'plugin-1' ] } );
			startSiteCreation( NEW_SITE );
			finishSiteCreation( NEW_SITE );
			rerender();
			// Flush all pending promises of WP-CLI command
			await act( () => jest.runOnlyPendingTimersAsync() );

			expect( result.current ).toEqual( {
				numberOfSites: 2,
				themeList: [ 'theme-1' ],
				pluginList: [ 'plugin-1' ],
				wpVersion: '6.6.2',
				phpVersion: '8.0',
				currentURL: 'http://localhost:8881',
				themeName: 'theme-1',
				isBlockTheme: true,
				availableEditors: [],
				siteName: 'New Test Site',
				os: 'darwin',
			} );
		} );

		it( 'fetches plugins and themes of new site after being added', async () => {
			const { result, rerender } = renderHook( () => useChatContext(), { wrapper } );

			// Reset initial WP-CLI command calls
			( getIpcApi().executeWPCLiInline as jest.Mock ).mockClear();

			setupWpCliResult( { themes: [ 'theme-1' ], plugins: [ 'plugin-1' ] } );
			startSiteCreation( NEW_SITE );
			rerender();

			// We don't fetch plugins and themes for the new sites while being added
			expect( getIpcApi().executeWPCLiInline ).not.toHaveBeenCalled();

			finishSiteCreation( NEW_SITE );
			rerender();
			// Flush all pending promises of WP-CLI command
			await act( () => jest.runOnlyPendingTimersAsync() );

			expect( result.current ).toEqual(
				expect.objectContaining( {
					themeList: [ 'theme-1' ],
					pluginList: [ 'plugin-1' ],
					siteName: 'New Test Site',
				} )
			);
			expect( getIpcApi().executeWPCLiInline ).toHaveBeenNthCalledWith( 1, {
				siteId: NEW_SITE.id,
				args: 'plugin list --format=json --status=active',
			} );
			expect( getIpcApi().executeWPCLiInline ).toHaveBeenNthCalledWith( 2, {
				siteId: NEW_SITE.id,
				args: 'theme list --format=json',
			} );
			expect( getIpcApi().executeWPCLiInline ).toHaveBeenCalledTimes( 2 );
		} );
	} );

	describe( 'when app gains focus', () => {
		it( 'fetches plugins and themes of site if running', async () => {
			let focusCallback: () => void;
			( useWindowListener as jest.Mock ).mockImplementation( ( event, callback ) => {
				if ( event === 'focus' ) {
					focusCallback = callback;
				}
			} );

			const { result, rerender } = renderHook( () => useChatContext(), { wrapper } );

			// Reset initial WP-CLI command calls
			( getIpcApi().executeWPCLiInline as jest.Mock ).mockClear();

			setupWpCliResult( { themes: [ 'theme-1' ], plugins: [ 'plugin-1' ] } );
			// Set selected site as running
			( useSiteDetails as jest.Mock ).mockReturnValue( {
				data: [ SELECTED_SITE ],
				loadingSites: false,
				selectedSite: { ...SELECTED_SITE, running: true },
			} );
			rerender();
			await act( () => {
				focusCallback();
			} );

			expect( result.current ).toEqual(
				expect.objectContaining( {
					themeList: [ 'theme-1' ],
					pluginList: [ 'plugin-1' ],
					siteName: 'Test Site',
				} )
			);
			expect( getIpcApi().executeWPCLiInline ).toHaveBeenNthCalledWith( 1, {
				siteId: SELECTED_SITE.id,
				args: 'plugin list --format=json --status=active',
			} );
			expect( getIpcApi().executeWPCLiInline ).toHaveBeenNthCalledWith( 2, {
				siteId: SELECTED_SITE.id,
				args: 'theme list --format=json',
			} );
			expect( getIpcApi().executeWPCLiInline ).toHaveBeenCalledTimes( 2 );
		} );

		it( 'does not fetch plugins and themes of site if not running', async () => {
			let focusCallback: () => void;
			( useWindowListener as jest.Mock ).mockImplementation( ( event, callback ) => {
				if ( event === 'focus' ) {
					focusCallback = callback;
				}
			} );

			renderHook( () => useChatContext(), { wrapper } );

			// Reset initial WP-CLI command calls
			( getIpcApi().executeWPCLiInline as jest.Mock ).mockClear();

			setupWpCliResult( { themes: [ 'theme-1' ], plugins: [ 'plugin-1' ] } );
			// By default, the selected site is not running
			await act( () => {
				focusCallback();
			} );

			expect( getIpcApi().executeWPCLiInline ).not.toHaveBeenCalled();
		} );

		it( 'does not fetch plugins and themes of site if is being added', async () => {
			let focusCallback: () => void;
			( useWindowListener as jest.Mock ).mockImplementation( ( event, callback ) => {
				if ( event === 'focus' ) {
					focusCallback = callback;
				}
			} );

			const { rerender } = renderHook( () => useChatContext(), { wrapper } );

			( getIpcApi().executeWPCLiInline as jest.Mock ).mockClear();

			// Set selected site as being added
			( useSiteDetails as jest.Mock ).mockReturnValue( {
				data: [ SELECTED_SITE ],
				loadingSites: false,
				selectedSite: { ...SELECTED_SITE, running: true, isAddingSite: true },
			} );
			rerender();
			await act( () => {
				focusCallback();
			} );

			expect( getIpcApi().executeWPCLiInline ).not.toHaveBeenCalled();
		} );
	} );
} );
