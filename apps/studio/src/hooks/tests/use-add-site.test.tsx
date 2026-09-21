// Run tests: yarn test -- src/hooks/tests/use-add-site.test.tsx
import { renderHook, act } from '@testing-library/react';
import nock from 'nock';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { useAddSite, CreateSiteFormValues } from 'src/hooks/use-add-site';
import { useAuth } from 'src/hooks/use-auth';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { store } from 'src/stores';
import type { SyncSite } from '@studio/common/types/sync';
import type { WPCOM } from 'wpcom/types';

vi.mock( 'src/hooks/use-site-details' );
vi.mock( 'src/hooks/use-feature-flags' );
vi.mock( 'src/hooks/use-auth' );
vi.mock( 'src/hooks/use-content-tabs' );

const mockPullSiteThunk = vi.hoisted( () => vi.fn() );

vi.mock( 'src/stores/sync', async () => {
	const actual = await vi.importActual< typeof import('src/stores/sync') >( 'src/stores/sync' );
	return {
		...actual,
		syncOperationsThunks: {
			...actual.syncOperationsThunks,
			pullSite: mockPullSiteThunk,
		},
	};
} );
vi.mock( 'src/hooks/use-import-export', () => ( {
	useImportExport: () => ( {
		importFile: vi.fn(),
		clearImportState: vi.fn(),
		importState: {},
	} ),
} ) );

const mockConnectWpcomSites = vi.fn().mockResolvedValue( undefined );
const mockShowOpenFolderDialog = vi.fn();
const mockGenerateProposedSitePath = vi.fn().mockResolvedValue( {
	path: '/default/path',
	name: 'Default Site',
	isEmpty: true,
	isWordPress: false,
} );
const mockComparePaths = vi.fn().mockResolvedValue( false );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		generateProposedSitePath: mockGenerateProposedSitePath,
		showOpenFolderDialog: mockShowOpenFolderDialog,
		showNotification: vi.fn(),
		getAllCustomDomains: vi.fn().mockResolvedValue( [] ),
		connectWpcomSites: mockConnectWpcomSites,
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		comparePaths: mockComparePaths,
	} ),
} ) );

const renderHookWithProvider = ( hook: () => ReturnType< typeof useAddSite > ) => {
	return renderHook< ReturnType< typeof useAddSite >, void >( hook, {
		wrapper: ( { children } ) => <Provider store={ store }>{ children }</Provider>,
	} );
};

describe( 'useAddSite', () => {
	const mockCreateSite = vi.fn();
	const mockUpdateSite = vi.fn();
	const mockStartServer = vi.fn();
	const mockClient = { req: { get: vi.fn(), post: vi.fn() } } as unknown as WPCOM;
	const mockSetSelectedTab = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		mockPullSiteThunk.mockImplementation( () => ( {
			type: 'syncOperations/pullSite',
		} ) );

		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default/path',
			name: 'Default Site',
			isEmpty: true,
			isWordPress: false,
		} );

		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			createSite: mockCreateSite,
			updateSite: mockUpdateSite,
			sites: [],
			loadingSites: false,
			startServer: mockStartServer,
		} );

		vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
			client: mockClient,
		} );

		mockSetSelectedTab.mockReset();
		vi.mocked( useContentTabs, { partial: true } ).mockReturnValue( {
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

	it( 'should create site with provided form values', async () => {
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

		const formValues: CreateSiteFormValues = {
			siteName: 'My Test Site',
			sitePath: '/test/path',
			phpVersion: '8.2',
			wpVersion: '6.1.7',
			useCustomDomain: false,
			customDomain: null,
			enableHttps: false,
		};

		await act( async () => {
			await result.current.handleCreateSite( formValues );
		} );

		expect( mockCreateSite ).toHaveBeenCalledWith(
			'/test/path',
			'My Test Site',
			'6.1.7',
			undefined,
			false,
			undefined, // blueprint parameter
			'8.2',
			expect.any( Function ),
			false,
			undefined, // adminUsername
			undefined, // adminPassword
			undefined, // adminEmail
			undefined, // runtime
			undefined, // fileAccess
			undefined // flowType
		);
	} );

	it( 'should generate proposed path for site name', async () => {
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/studio/my-site',
			isEmpty: true,
			isWordPress: false,
		} );

		const { result } = renderHookWithProvider( () => useAddSite() );

		let pathResult;
		await act( async () => {
			pathResult = await result.current.generateProposedPath( 'My Site' );
		} );

		expect( mockGenerateProposedSitePath ).toHaveBeenCalledWith( 'My Site' );
		expect( pathResult ).toEqual( {
			path: '/studio/my-site',
			isEmpty: true,
			isWordPress: false,
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
			phpVersion: '8.4',
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
		} );

		const formValues: CreateSiteFormValues = {
			siteName: createdSite.name,
			sitePath: createdSite.path,
			phpVersion: '8.4',
			wpVersion: 'latest',
			useCustomDomain: false,
			customDomain: null,
			enableHttps: false,
		};

		await act( async () => {
			await result.current.handleCreateSite( formValues );
		} );

		expect( mockConnectWpcomSites ).toHaveBeenCalledWith( [
			{
				sites: [ remoteSite ],
				localSiteId: createdSite.id,
			},
		] );
		expect( mockPullSiteThunk ).toHaveBeenCalledWith( {
			client: mockClient,
			connectedSite: remoteSite,
			selectedSite: createdSite,
			options: { optionsToSync: [ 'all' ] },
		} );
		expect( mockSetSelectedTab ).toHaveBeenCalledWith( 'sync' );
	} );
} );
