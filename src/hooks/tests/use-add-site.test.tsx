// Run tests: yarn test -- src/hooks/tests/use-add-site.test.tsx
import { renderHook, act } from '@testing-library/react';
import nock from 'nock';
import { Provider } from 'react-redux';
import { useSyncSites } from 'src/hooks/sync-sites';
import { useAddSite } from 'src/hooks/use-add-site';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getWordPressProvider } from 'src/lib/wordpress-provider';
import { store } from 'src/stores';
import { setProviderConstants } from 'src/stores/provider-constants-slice';
import type { SyncSitesContextType } from 'src/hooks/sync-sites/sync-sites-context';
import type { SyncSite } from 'src/modules/sync/types';

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

const mockConnectWpcomSites = jest.fn().mockResolvedValue( undefined );
const mockGenerateProposedSitePath = jest.fn().mockResolvedValue( {
	path: '/default/path',
	name: 'Default Site',
	isEmpty: true,
	isWordPress: false,
} );

const mockComparePaths = jest.fn().mockResolvedValue( false );

jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		generateProposedSitePath: mockGenerateProposedSitePath,
		showNotification: jest.fn(),
		getAllCustomDomains: jest.fn().mockResolvedValue( [] ),
		connectWpcomSites: mockConnectWpcomSites,
		getConnectedWpcomSites: jest.fn().mockResolvedValue( [] ),
		comparePaths: mockComparePaths,
	} ),
} ) );

const renderHookWithProvider = ( hook: () => ReturnType< typeof useAddSite > ) => {
	return renderHook< ReturnType< typeof useAddSite >, void >( hook, {
		wrapper: ( { children } ) => <Provider store={ store }>{ children }</Provider>,
	} );
};

describe( 'useAddSite', () => {
	const mockCreateSite = jest.fn();
	const mockUpdateSite = jest.fn();
	const mockStartServer = jest.fn();
	const mockPullSite = jest.fn();
	const mockSetSelectedTab = jest.fn();

	beforeEach( () => {
		jest.clearAllMocks();

		// Prepopulate store with provider constants
		store.dispatch(
			setProviderConstants( {
				defaultPhpVersion: '8.3',
				defaultWordPressVersion: 'latest',
				allowedPhpVersions: [ '8.0', '8.1', '8.2', '8.3' ],
				minimumWordPressVersion: '5.9.9',
			} )
		);

		( useSiteDetails as jest.Mock ).mockReturnValue( {
			createSite: mockCreateSite,
			updateSite: mockUpdateSite,
			sites: [],
			loadingSites: false,
			startServer: mockStartServer,
		} );

		mockPullSite.mockReset();
		( useSyncSites as jest.Mock ).mockReturnValue( {
			pullSite: mockPullSite,
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
			cancelPush: jest.fn(),
		} as SyncSitesContextType );

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
			( path, name, wpVersion, customDomain, enableHttps, blueprint, phpVersion, callback ) => {
				callback( {
					id: 'test-id',
					name: name || 'Test Site',
					path,
					wpVersion,
					phpVersion,
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
			'8.3',
			expect.any( Function )
		);
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
			( path, name, version, customDomain, enableHttps, blueprint, phpVersion, callback ) => {
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

		expect( mockConnectWpcomSites ).toHaveBeenCalledWith( [
			{
				sites: [ remoteSite ],
				localSiteId: createdSite.id,
			},
		] );
		expect( mockPullSite ).toHaveBeenCalledWith( remoteSite, createdSite, {
			optionsToSync: [ 'all' ],
		} );
		expect( mockSetSelectedTab ).toHaveBeenCalledWith( 'sync' );
	} );

	describe( 'handleSiteNameChange', () => {
		beforeEach( () => {
			mockGenerateProposedSitePath.mockReset();
			mockGenerateProposedSitePath.mockResolvedValue( {
				path: '/default/path',
				name: 'Default Site',
				isEmpty: true,
				isWordPress: false,
			} );
			mockComparePaths.mockReset();
			mockComparePaths.mockResolvedValue( false );
		} );

		it( 'should set user-friendly error when site name causes ENAMETOOLONG error', async () => {
			mockGenerateProposedSitePath.mockResolvedValueOnce( {
				path: '/default/path/very-long-name',
				name: 'a'.repeat( 300 ),
				isEmpty: false,
				isWordPress: false,
				isNameTooLong: true,
			} );

			const { result } = renderHookWithProvider( () => useAddSite() );

			await act( async () => {
				await result.current.handleSiteNameChange( 'a'.repeat( 300 ) );
			} );

			expect( result.current.error ).toBe(
				'The site name is too long. Please choose a shorter site name.'
			);
		} );

		it( 'should successfully update site name when path is valid', async () => {
			mockGenerateProposedSitePath.mockResolvedValueOnce( {
				path: '/default/path/my-site',
				name: 'my-site',
				isEmpty: true,
				isWordPress: false,
			} );

			const { result } = renderHookWithProvider( () => useAddSite() );

			await act( async () => {
				await result.current.handleSiteNameChange( 'my-site' );
			} );

			expect( result.current.siteName ).toBe( 'my-site' );
			expect( result.current.error ).toBe( '' );
		} );
	} );
} );
