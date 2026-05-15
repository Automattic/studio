import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { useAuth } from 'src/hooks/use-auth';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useCreateLocalSiteFromRemote } from 'src/hooks/use-create-local-site-from-remote';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch } from 'src/stores';
import { syncOperationsThunks } from 'src/stores/sync';
import { useConnectSiteMutation } from 'src/stores/sync/connected-sites';
import type { SyncSite } from '@studio/common/types/sync';

const mockConnectSite = vi.hoisted( () => vi.fn() );
const mockDispatch = vi.hoisted( () => vi.fn() );
const mockPullSiteThunk = vi.hoisted( () => vi.fn() );

vi.mock( '@sentry/electron/renderer', () => ( {
	captureException: vi.fn(),
} ) );
vi.mock( 'src/hooks/use-auth' );
vi.mock( 'src/hooks/use-content-tabs' );
vi.mock( 'src/hooks/use-site-details' );
vi.mock( 'src/stores', () => ( {
	useAppDispatch: vi.fn(),
} ) );
vi.mock( 'src/stores/sync/connected-sites', () => ( {
	useConnectSiteMutation: vi.fn(),
} ) );
vi.mock( 'src/stores/sync', () => ( {
	syncOperationsThunks: {
		pullSite: mockPullSiteThunk,
	},
} ) );

const mockGenerateProposedSitePath = vi.fn();
const mockShowMessageBox = vi.fn();
const mockShowErrorMessageBox = vi.fn();
const mockComparePaths = vi.fn();

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: vi.fn( () => ( {
		generateProposedSitePath: mockGenerateProposedSitePath,
		showMessageBox: mockShowMessageBox,
		showErrorMessageBox: mockShowErrorMessageBox,
		comparePaths: mockComparePaths,
	} ) ),
} ) );

const remoteSite: SyncSite = {
	id: 123,
	localSiteId: '',
	name: 'Remote Site',
	url: 'https://remote-site.example',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
};

const createdLocalSite: SiteDetails = {
	id: 'local-site-id',
	name: 'Remote Site',
	path: '/Users/dsmart/Studio/remote-site',
	port: 8881,
	running: false,
	phpVersion: '8.4',
};

describe( 'useCreateLocalSiteFromRemote', () => {
	const mockCreateSite = vi.fn();
	const mockSetWpcomSiteActivity = vi.fn();
	const mockSetSelectedTab = vi.fn();
	const mockClient = { req: { get: vi.fn(), post: vi.fn() } };

	beforeEach( () => {
		vi.clearAllMocks();
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: createdLocalSite.path,
			name: createdLocalSite.name,
			isEmpty: true,
			isWordPress: false,
			isNameTooLong: false,
		} );
		mockShowMessageBox.mockResolvedValue( { response: 0 } );
		mockComparePaths.mockResolvedValue( false );
		mockConnectSite.mockResolvedValue( {} );
		mockPullSiteThunk.mockImplementation( ( payload ) => ( {
			type: 'syncOperations/pullSite',
			payload,
		} ) );
		mockDispatch.mockReturnValue( undefined );
		mockCreateSite.mockImplementation(
			async (
				_sitePath,
				_siteName,
				_wpVersion,
				_customDomain,
				_enableHttps,
				_blueprint,
				_phpVersion,
				afterCreate: ( site: SiteDetails ) => Promise< void >
			) => {
				await afterCreate( createdLocalSite );
				return createdLocalSite;
			}
		);

		vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
			client: mockClient as never,
		} );
		vi.mocked( useContentTabs, { partial: true } ).mockReturnValue( {
			selectedTab: 'overview',
			setSelectedTab: mockSetSelectedTab,
			tabs: [],
		} );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			createSite: mockCreateSite,
			sites: [],
			wpcomSiteActivity: {},
			setWpcomSiteActivity: mockSetWpcomSiteActivity,
		} );
		vi.mocked( useAppDispatch ).mockReturnValue( mockDispatch );
		vi.mocked( useConnectSiteMutation ).mockReturnValue( [ mockConnectSite, {} ] as never );
	} );

	it( 'creates a local site, connects it to the remote target, and starts a full pull', async () => {
		const { result } = renderHook( () => useCreateLocalSiteFromRemote() );

		let createdSite: SiteDetails | void = undefined;
		await act( async () => {
			createdSite = await result.current.confirmCreateLocalSiteFromRemote( remoteSite );
		} );

		expect( createdSite ).toBe( createdLocalSite );
		expect( getIpcApi().generateProposedSitePath ).toHaveBeenCalledWith( remoteSite.name );
		expect( getIpcApi().showMessageBox ).toHaveBeenCalledWith(
			expect.objectContaining( {
				message: 'Create local site',
				buttons: [ 'Create local site', 'Cancel' ],
				cancelId: 1,
			} )
		);
		expect( mockSetWpcomSiteActivity ).toHaveBeenCalledWith( remoteSite.id, {
			isCreatingLocalSite: true,
		} );
		expect( mockSetWpcomSiteActivity ).toHaveBeenCalledWith( remoteSite.id, {
			isCreatingLocalSite: false,
		} );
		expect( mockConnectSite ).toHaveBeenCalledWith( {
			site: remoteSite,
			localSiteId: createdLocalSite.id,
		} );
		expect( syncOperationsThunks.pullSite ).toHaveBeenCalledWith( {
			client: mockClient,
			connectedSite: remoteSite,
			selectedSite: createdLocalSite,
			options: { optionsToSync: [ 'all' ] },
		} );
		expect( mockDispatch ).toHaveBeenCalledWith(
			expect.objectContaining( { type: 'syncOperations/pullSite' } )
		);
		expect( mockSetSelectedTab ).toHaveBeenCalledWith( 'sync' );
	} );

	it( 'does not create when the confirmation is cancelled', async () => {
		mockShowMessageBox.mockResolvedValue( { response: 1 } );
		const { result } = renderHook( () => useCreateLocalSiteFromRemote() );

		await act( async () => {
			await result.current.confirmCreateLocalSiteFromRemote( remoteSite );
		} );

		expect( mockCreateSite ).not.toHaveBeenCalled();
		expect( mockConnectSite ).not.toHaveBeenCalled();
		expect( mockDispatch ).not.toHaveBeenCalled();
	} );
} );
