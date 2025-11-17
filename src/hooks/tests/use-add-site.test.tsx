// Run tests: yarn test -- src/hooks/tests/use-add-site.test.tsx
import { configureStore } from '@reduxjs/toolkit';
import { renderHook, act } from '@testing-library/react';
import nock from 'nock';
import { Provider } from 'react-redux';
import { useSyncSites } from 'src/hooks/sync-sites';
import { useAddSite } from 'src/hooks/use-add-site';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getWordPressProvider } from 'src/lib/wordpress-provider';
import providerConstantsReducer from 'src/stores/provider-constants-slice';
import { useConnectedSitesOperations } from 'src/stores/sync';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

jest.mock( 'src/hooks/use-site-details' );
jest.mock( 'src/hooks/use-feature-flags' );
jest.mock( 'src/hooks/sync-sites' );
jest.mock( 'src/hooks/use-content-tabs' );
jest.mock( 'src/hooks/use-import-export', () => ( {
	useImportExport: () => ( {
		importFile: jest.fn(),
		clearImportState: jest.fn(),
	} ),
} ) );

jest.mock( 'src/stores/sync', () => ( {
	useConnectedSitesOperations: jest.fn(),
} ) );

jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		generateProposedSitePath: jest.fn().mockResolvedValue( {
			path: '/default/path',
			name: 'Default Site',
			isEmpty: true,
			isWordPress: false,
		} ),
		showNotification: jest.fn(),
		getAllCustomDomains: jest.fn().mockResolvedValue( [] ),
	} ),
} ) );

// Helper to create a store with preloaded provider constants
function makeStoreWithProviderConstants( overrides = {} ) {
	return configureStore( {
		reducer: {
			providerConstants: providerConstantsReducer,
			// ...add other reducers as needed
		},
		preloadedState: {
			providerConstants: {
				defaultPhpVersion: '8.3',
				defaultWordPressVersion: 'latest',
				allowedPhpVersions: [ '8.0', '8.1', '8.2', '8.3' ],
				minimumWordPressVersion: '5.9.9',
				...overrides,
			},
		},
	} );
}

const renderHookWithProvider = (
	hook: () => ReturnType< typeof useAddSite >,
	store = makeStoreWithProviderConstants()
) => {
	return renderHook< ReturnType< typeof useAddSite >, void >( hook, {
		wrapper: ( { children } ) => <Provider store={ store }>{ children }</Provider>,
	} );
};

describe( 'useAddSite', () => {
	const mockCreateSite = jest.fn();
	const mockUpdateSite = jest.fn();
	const mockStartServer = jest.fn();
	const mockConnectSite = jest.fn();
	const mockPullSite = jest.fn();
	const mockSetSelectedTab = jest.fn();

	beforeEach( () => {
		jest.clearAllMocks();

		( useSiteDetails as jest.Mock ).mockReturnValue( {
			createSite: mockCreateSite,
			updateSite: mockUpdateSite,
			data: [],
			loadingSites: false,
			startServer: mockStartServer,
		} );

		mockConnectSite.mockResolvedValue( undefined );

		( useConnectedSitesOperations as jest.Mock ).mockReturnValue( {
			connectSite: mockConnectSite,
		} );

		mockPullSite.mockReset();
		( useSyncSites as jest.Mock ).mockReturnValue( {
			pullSite: mockPullSite,
			syncSites: [],
			refetchSites: jest.fn(),
			isFetching: false,
			isAnySitePulling: false,
			isSiteIdPulling: jest.fn(),
			clearPullState: jest.fn(),
			cancelPull: jest.fn(),
			getPullState: jest.fn(),
			pushSite: jest.fn(),
			isAnySitePushing: false,
			isSiteIdPushing: jest.fn(),
			clearPushState: jest.fn(),
			getPushState: jest.fn(),
			getLastSyncTimeText: jest.fn(),
		} );

		mockSetSelectedTab.mockReset();
		( useContentTabs as jest.Mock ).mockReturnValue( {
			selectedTab: 'overview',
			setSelectedTab: mockSetSelectedTab,
			tabs: [],
		} );

		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'beta', version: '5.9.9' } )
			.reply( 200, {
				offers: [
					{
						version: '6.1.7',
						response: 'autoupdate',
					},
					{
						version: '6.2.0',
						response: 'autoupdate',
					},
				],
			} );

		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'development' } )
			.reply( 200, {
				offers: [],
			} );
	} );

	afterEach( () => {
		nock.cleanAll();
	} );

	it( 'should initialize with default WordPress version', () => {
		const { result } = renderHookWithProvider( () => useAddSite() );

		expect( result.current.wpVersion ).toBe( getWordPressProvider().DEFAULT_WORDPRESS_VERSION );
	} );

	it( 'should initialize with default PHP version', () => {
		const { result } = renderHookWithProvider( () => useAddSite() );

		expect( result.current.phpVersion ).toBe( '8.3' );
	} );

	it( 'should update WordPress version when setWpVersion is called', () => {
		const { result } = renderHookWithProvider( () => useAddSite() );

		act( () => {
			result.current.setWpVersion( '6.1.7' );
		} );

		expect( result.current.wpVersion ).toBe( '6.1.7' );
	} );

	it( 'should update PHP version when setPhpVersion is called', () => {
		const { result } = renderHookWithProvider( () => useAddSite() );

		act( () => {
			result.current.setPhpVersion( '8.2' );
		} );

		expect( result.current.phpVersion ).toBe( '8.2' );
	} );

	it( 'should pass WordPress version to createSite when handleAddSiteClick is called', async () => {
		mockCreateSite.mockImplementation(
			( path, name, wpVersion, customDomain, enableHttps, blueprint, callback ) => {
				callback( {
					id: 'test-id',
					name: name || 'Test Site',
					path: path,
					wpVersion: wpVersion,
					phpVersion: '8.2',
				} );
				return Promise.resolve();
			}
		);

		const { result } = renderHookWithProvider( () => useAddSite() );

		act( () => {
			result.current.setWpVersion( '6.1.7' );
			result.current.setSitePath( '/test/path' );
		} );

		await act( async () => {
			await result.current.handleAddSiteClick();
		} );

		expect( mockCreateSite ).toHaveBeenCalledWith(
			'/test/path',
			'',
			'6.1.7',
			undefined,
			false,
			undefined, // blueprint parameter
			expect.any( Function )
		);
	} );

	it( 'should still call updateSite even if wpVersion matches due to object comparison', async () => {
		const wpVersion = '6.1.7';
		const newSite = {
			id: 'test-id',
			name: 'Test Site',
			path: '/test/path',
			wpVersion: wpVersion,
			phpVersion: '8.3',
		};

		mockCreateSite.mockImplementation(
			( path, name, version, customDomain, enableHttps, blueprint, callback ) => {
				callback( {
					...newSite,
					wpVersion: version,
				} );
				return Promise.resolve();
			}
		);

		const { result } = renderHookWithProvider( () => useAddSite() );

		act( () => {
			result.current.setWpVersion( wpVersion );
			result.current.setSitePath( '/test/path' );
		} );

		mockUpdateSite.mockClear();

		await act( async () => {
			await result.current.handleAddSiteClick();
		} );

		expect( mockUpdateSite ).toHaveBeenCalled();

		expect( mockUpdateSite ).toHaveBeenCalledWith( {
			...newSite,
			wpVersion,
		} );
	} );

	it( 'should connect and start pulling when a remote site is selected', async () => {
		const remoteSite: SyncSite = {
			id: 123,
			localSiteId: 'remote-site-id',
			name: 'Remote Site',
			url: 'https://example.com',
			isStaging: false,
			isPressable: false,
			environmentType: null,
			syncSupport: 'syncable',
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		};

		const createdSite = {
			id: 'local-id',
			name: 'New Site',
			path: '/test/path',
			wpVersion: 'latest',
			phpVersion: '8.3',
		};

		mockCreateSite.mockImplementation(
			( path, name, version, customDomain, enableHttps, blueprint, callback ) => {
				callback( createdSite );
				return Promise.resolve();
			}
		);

		const { result } = renderHookWithProvider( () => useAddSite() );

		act( () => {
			result.current.setSelectedRemoteSite( remoteSite );
			result.current.setSitePath( createdSite.path );
		} );

		await act( async () => {
			await result.current.handleAddSiteClick();
		} );

		expect( mockConnectSite ).toHaveBeenCalledWith( remoteSite, createdSite.id );
		expect( mockPullSite ).toHaveBeenCalledWith( remoteSite, createdSite, {
			optionsToSync: [ 'all' ],
		} );
		expect( mockSetSelectedTab ).toHaveBeenCalledWith( 'sync' );
	} );
} );
