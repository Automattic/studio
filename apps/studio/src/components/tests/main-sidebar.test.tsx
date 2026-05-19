import { configureStore } from '@reduxjs/toolkit';
import { render, act, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import MainSidebar from 'src/components/main-sidebar';
import { useAuth } from 'src/hooks/use-auth';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { WorkspaceSelectionProvider } from 'src/modules/workspaces';
import {
	clearWorkspaceDollyAssistantStateCacheForTests,
	getWorkspaceDollyConversationState,
	writeWorkspaceDollyConversationState,
} from 'src/modules/workspaces/lib/dolly/session';
import { startWorkspaceDollyTurn } from 'src/modules/workspaces/lib/dolly/turns';
import {
	WORKSPACE_DOLLY_AGENT_ID,
	type WorkspaceDollyConversationState,
} from 'src/modules/workspaces/lib/dolly/types';
import { store } from 'src/stores';
import { installedAppsApi } from 'src/stores/installed-apps-api';
import { stagingSyncActions, stagingSyncThunks } from 'src/stores/sync';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';
import type { SyncSite } from '@studio/common/types/sync';

const featureFlagsMock = vi.hoisted( () => ( {
	enableBlueprints: true,
	enableStudioCodeUi: false,
	enableWorkspaces: false,
} ) );
const ipcApiMock = vi.hoisted( () => ( {
	getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
	showOpenFolderDialog: vi.fn(),
	generateProposedSitePath: vi.fn(),
	openURL: vi.fn(),
	getAllCustomDomains: vi.fn().mockResolvedValue( [] ),
	getUserEditor: vi.fn().mockResolvedValue( 'cursor' ),
	getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
	setWindowControlVisibility: vi.fn(),
	setupAppMenu: vi.fn(),
	addSyncOperation: vi.fn(),
	clearSyncOperation: vi.fn(),
} ) );
const useGetWpComSitesQueryMock = vi.hoisted( () => vi.fn() );

vi.mock( 'src/hooks/use-auth' );
vi.mock( 'src/hooks/use-feature-flags', () => ( {
	useFeatureFlags: () => featureFlagsMock,
} ) );

vi.mock( 'src/stores/wordpress-versions-api', () => ( {
	wordpressVersionsApi: {
		reducer: () => ( {} ),
		middleware: () => () => () => {},
	},
	useGetWordPressVersions: vi.fn( () => ( {
		data: [
			{ label: 'Latest', value: '6.7.2' },
			{ label: '6.8-beta1', value: '6.8-beta1', isBeta: true, isDevelopment: false },
			{ label: '6.4', value: '6.4', isBeta: false, isDevelopment: false },
			{ label: '6.3', value: '6.3', isBeta: false, isDevelopment: false },
			{ label: '6.2', value: '6.2', isBeta: false, isDevelopment: false },
		],
		isLoading: false,
	} ) ),
} ) );

vi.mock( 'src/stores/wpcom-api', async () => {
	const actual = ( await vi.importActual( 'src/stores/wpcom-api' ) ) || {};
	return {
		...actual,
		useGetBlueprints: vi.fn().mockReturnValue( {
			data: {
				blueprints: [],
				total: 0,
			},
			isLoading: false,
			refetch: vi.fn(),
			isUninitialized: false,
		} ),
	};
} );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	__esModule: true,
	default: vi.fn(),
	getIpcApi: () => ipcApiMock,
} ) );

vi.mock( 'src/stores/sync/wpcom-sites', async () => {
	const actual = await vi.importActual< typeof import('src/stores/sync/wpcom-sites') >(
		'src/stores/sync/wpcom-sites'
	);
	return {
		...actual,
		useGetWpComSitesQuery: useGetWpComSitesQueryMock,
	};
} );

store.replaceReducer( testReducer );

const createLocalSite = ( overrides: Partial< SiteDetails > = {} ): SiteDetails =>
	( {
		name: 'test-1',
		path: '/fake/test-1',
		running: false,
		id: '0e9e237b-335a-43fa-b439-9b078a618512',
		port: 8881,
		phpVersion: '8.4',
		...overrides,
	} ) as SiteDetails;

const createSyncSite = ( overrides: Partial< SyncSite > = {} ): SyncSite => ( {
	id: 101,
	localSiteId: '',
	name: 'Business Plan',
	url: 'https://business.example',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
	...overrides,
} );

const seedWorkspaceConversation = ( {
	workspaceId,
	conversationId,
	message,
	lastUpdated = Date.now(),
}: {
	workspaceId: string;
	conversationId: string;
	message: string;
	lastUpdated?: number;
} ) => {
	writeWorkspaceDollyConversationState( {
		id: conversationId,
		key: {
			workspaceId,
			agentId: WORKSPACE_DOLLY_AGENT_ID,
		},
		input: '',
		messages: [
			{
				id: 0,
				role: 'user',
				content: message,
				createdAt: lastUpdated,
			},
		],
		lastUpdated,
	} as WorkspaceDollyConversationState );
};

const site2 = createLocalSite( {
	name: 'test-2',
	path: '/fake/test-2',
	running: false,
	id: 'da1dad4b-37d5-41d2-a77b-26d5e0649ec3',
	port: 8882,
} );
const siteDetailsMocked = {
	selectedSite: site2,
	sites: [
		createLocalSite(),
		site2,
		createLocalSite( {
			name: 'test-3',
			path: '/fake/test-3',
			running: true,
			id: '0e9e237b-335a-43fa-b439-9b078a613333',
			port: 8883,
		} ),
	],
	loadingServer: {
		[ site2.id ]: false,
	},
	snapshots: [],
	setSelectedSiteId: vi.fn(),
	createSite: vi.fn(),
	startServer: vi.fn(),
	stopServer: vi.fn(),
	isSiteDeleting: vi.fn( () => false ),
};
vi.mock( 'src/hooks/use-site-details', () => ( {
	useSiteDetails: () => ( { ...siteDetailsMocked } ),
} ) );

const defaultLocalSites = () => [
	createLocalSite(),
	site2,
	createLocalSite( {
		name: 'test-3',
		path: '/fake/test-3',
		running: true,
		id: '0e9e237b-335a-43fa-b439-9b078a613333',
		port: 8883,
	} ),
];

const mockWpcomSitesQuery = ( sites: SyncSite[] = [] ) => {
	useGetWpComSitesQueryMock.mockReturnValue( {
		data: { sites, total: sites.length, page: 1, perPage: 100 },
		isLoading: false,
		isFetching: false,
	} );
};

const enableWorkspaceSidebar = ( {
	localSites = [],
	wpcomSites = [],
	connectedSites = [],
}: {
	localSites?: SiteDetails[];
	wpcomSites?: SyncSite[];
	connectedSites?: SyncSite[];
} ) => {
	featureFlagsMock.enableWorkspaces = true;
	siteDetailsMocked.sites = localSites;
	siteDetailsMocked.selectedSite = localSites[ 0 ] ?? null;
	vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
		isAuthenticated: true,
		user: { id: 123, email: 'user@example.com', displayName: 'User' },
		client: {} as never,
	} );
	ipcApiMock.getConnectedWpcomSites.mockResolvedValue( connectedSites );
	mockWpcomSitesQuery( wpcomSites );
};

const renderWithProvider = ( children: React.ReactElement, reduxStore = store ) => {
	return render(
		<Provider store={ reduxStore }>
			<ContentTabsProvider>
				<WorkspaceSelectionProvider>{ children }</WorkspaceSelectionProvider>
			</ContentTabsProvider>
		</Provider>
	);
};

describe( 'MainSidebar Footer', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		localStorage.clear();
		clearWorkspaceDollyAssistantStateCacheForTests();
		store.dispatch( testActions.resetState() );
		featureFlagsMock.enableWorkspaces = false;
		siteDetailsMocked.sites = defaultLocalSites();
		siteDetailsMocked.selectedSite = site2;
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( { isAuthenticated: false } );
		ipcApiMock.getConnectedWpcomSites.mockResolvedValue( [] );
		mockWpcomSitesQuery();
	} );
	it( 'Has add site button', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( { isAuthenticated: false } );
		await act( async () => renderWithProvider( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'Add site' } ) ).toBeVisible();
	} );

	it( 'applies className prop', async () => {
		const { container } = await act( async () =>
			renderWithProvider( <MainSidebar className={ 'test-class' } /> )
		);
		expect( container.firstChild ).toHaveClass( 'test-class' );
	} );

	it( 'shows a "Stop" button when there is a running site', async () => {
		await act( async () => renderWithProvider( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'Stop' } ) ).toBeVisible();
	} );

	it( 'shows a "Stop All" button when there are multiple running sites', async () => {
		site2.running = true;
		await act( async () => renderWithProvider( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'Stop all' } ) ).toBeVisible();
		site2.running = false;
	} );
} );

describe( 'MainSidebar Site Menu', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		localStorage.clear();
		clearWorkspaceDollyAssistantStateCacheForTests();
		store.dispatch( testActions.resetState() );
		featureFlagsMock.enableWorkspaces = false;
		siteDetailsMocked.sites = defaultLocalSites();
		siteDetailsMocked.selectedSite = site2;
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( { isAuthenticated: false } );
		ipcApiMock.getConnectedWpcomSites.mockResolvedValue( [] );
		mockWpcomSitesQuery();
	} );

	it( 'renders the list of sites', async () => {
		await act( async () => renderWithProvider( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'test-1' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'test-2' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'test-3' } ) ).toBeVisible();
	} );

	it( 'has "start site" buttons when sites are not running', async () => {
		await act( async () => renderWithProvider( <MainSidebar /> ) );
		expect( screen.getByRole( 'button', { name: 'start test-1 site' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'start test-2 site' } ) ).toBeVisible();
	} );

	it( 'starts a site', async () => {
		const user = userEvent.setup();
		await act( async () => renderWithProvider( <MainSidebar /> ) );
		const greenDotFirstSite = screen.getByRole( 'button', { name: 'start test-1 site' } );
		expect( greenDotFirstSite ).toBeVisible();
		await user.click( greenDotFirstSite );
		expect( siteDetailsMocked.startServer ).toHaveBeenCalledWith(
			expect.objectContaining( { id: '0e9e237b-335a-43fa-b439-9b078a618512', name: 'test-1' } )
		);
	} );

	it( 'stops a site', async () => {
		const user = userEvent.setup();
		await act( async () => renderWithProvider( <MainSidebar /> ) );
		const greenDotFirstSite = screen.getByRole( 'button', { name: 'stop test-3 site' } );
		expect( greenDotFirstSite ).toBeVisible();
		await user.click( greenDotFirstSite );
		expect( siteDetailsMocked.stopServer ).toHaveBeenCalledWith(
			'0e9e237b-335a-43fa-b439-9b078a613333'
		);
	} );
} );

describe( 'MainSidebar Workspace Site Menu', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		localStorage.clear();
		clearWorkspaceDollyAssistantStateCacheForTests();
		store.dispatch( testActions.resetState() );
		store.dispatch( stagingSyncActions.clearStagingSyncState( { productionSiteId: 101 } ) );
		ipcApiMock.getConnectedWpcomSites.mockResolvedValue( [] );
		mockWpcomSitesQuery();
	} );

	it( 'renders a local-only workspace', async () => {
		const localSite = createLocalSite( { id: 'local-only', name: 'Local Only' } );
		enableWorkspaceSidebar( { localSites: [ localSite ] } );

		await act( async () => renderWithProvider( <MainSidebar /> ) );

		expect( screen.getByRole( 'button', { name: 'Local Only' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'start Local Only site' } ) ).toBeVisible();
	} );

	it( 'renders local and production targets as one workspace', async () => {
		const localSite = createLocalSite( { id: 'business-local', name: 'Business Plan' } );
		const productionSite = createSyncSite( {
			id: 101,
			localSiteId: localSite.id,
			name: 'Business Plan',
			syncSupport: 'already-connected',
		} );
		enableWorkspaceSidebar( {
			localSites: [ localSite ],
			wpcomSites: [ productionSite ],
			connectedSites: [ productionSite ],
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );
		await screen.findByRole( 'button', { name: 'Business Plan' } );

		expect( screen.getAllByRole( 'button', { name: 'Business Plan' } ) ).toHaveLength( 1 );
	} );

	it( 'renders production and staging targets as one remote-only workspace', async () => {
		const productionSite = createSyncSite( {
			id: 101,
			name: 'Remote Store',
			url: 'https://remote.example',
			stagingSiteIds: [ 202 ],
		} );
		const stagingSite = createSyncSite( {
			id: 202,
			name: 'Remote Store Staging',
			url: 'https://remote-staging.example',
			isStaging: true,
			productionSiteId: 101,
		} );
		enableWorkspaceSidebar( {
			wpcomSites: [ productionSite, stagingSite ],
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );

		expect( await screen.findByRole( 'button', { name: 'Remote Store' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'Remote Store Staging' } )
		).not.toBeInTheDocument();
	} );

	it( 'renders local, production, and staging targets as one workspace', async () => {
		const localSite = createLocalSite( { id: 'full-local', name: 'Full Workspace' } );
		const productionSite = createSyncSite( {
			id: 101,
			localSiteId: localSite.id,
			name: 'Full Workspace',
			stagingSiteIds: [ 202 ],
			syncSupport: 'already-connected',
		} );
		const stagingSite = createSyncSite( {
			id: 202,
			localSiteId: localSite.id,
			name: 'Full Workspace Staging',
			url: 'https://full-staging.example',
			isStaging: true,
			productionSiteId: 101,
			syncSupport: 'already-connected',
		} );
		enableWorkspaceSidebar( {
			localSites: [ localSite ],
			wpcomSites: [ productionSite, stagingSite ],
			connectedSites: [ productionSite, stagingSite ],
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );
		await screen.findByRole( 'button', { name: 'Full Workspace' } );

		expect( screen.getAllByRole( 'button', { name: 'Full Workspace' } ) ).toHaveLength( 1 );
	} );

	it( 'renders production-only remote workspaces in the workspace list', async () => {
		const productionSite = createSyncSite( {
			id: 303,
			name: 'Remote Only',
			url: 'https://remote-only.example',
		} );
		enableWorkspaceSidebar( {
			wpcomSites: [ productionSite ],
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );

		expect( await screen.findByRole( 'button', { name: 'Remote Only' } ) ).toBeVisible();
	} );

	it( 'does not duplicate local-backed workspaces when connected metadata overlaps WP.com data', async () => {
		const localSite = createLocalSite( { id: 'overlap-local', name: 'Overlap Site' } );
		const productionSite = createSyncSite( {
			id: 101,
			localSiteId: localSite.id,
			name: 'Overlap Site',
			syncSupport: 'already-connected',
		} );
		enableWorkspaceSidebar( {
			localSites: [ localSite ],
			wpcomSites: [ productionSite ],
			connectedSites: [ productionSite ],
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );
		await screen.findByRole( 'button', { name: 'Overlap Site' } );

		expect( screen.getAllByRole( 'button', { name: 'Overlap Site' } ) ).toHaveLength( 1 );
	} );

	it( 'does not render target indicators inside workspace rows', async () => {
		const localSite = createLocalSite( { id: 'labels-local', name: 'Label Site' } );
		const productionSite = createSyncSite( {
			id: 101,
			localSiteId: localSite.id,
			name: 'Label Site',
			stagingSiteIds: [ 202 ],
		} );
		const stagingSite = createSyncSite( {
			id: 202,
			localSiteId: localSite.id,
			name: 'Label Site Staging',
			url: 'https://label-staging.example',
			isStaging: true,
			productionSiteId: 101,
		} );
		enableWorkspaceSidebar( {
			localSites: [ localSite ],
			wpcomSites: [ productionSite, stagingSite ],
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Label Site' } ) ).toBeVisible()
		);

		expect( screen.queryByLabelText( /Production target:/ ) ).not.toBeInTheDocument();
		expect( screen.queryByLabelText( /Staging target:/ ) ).not.toBeInTheDocument();
		expect( screen.queryByLabelText( /Local target:/ ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: /Staging target:/ } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: /Local target:/ } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'P' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'S' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'L' } ) ).not.toBeInTheDocument();
	} );

	it( 'shows workspace activity when the assistant is thinking', async () => {
		const productionSite = createSyncSite( {
			id: 101,
			name: 'Remote Only',
			url: 'https://remote-only.example',
		} );
		enableWorkspaceSidebar( {
			wpcomSites: [ productionSite ],
		} );
		startWorkspaceDollyTurn( {
			workspaceId: 'studio-workspace:wpcom:101',
			conversationId: 'remote-only-chat',
			abortController: new AbortController(),
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );

		expect( await screen.findByLabelText( 'Remote Only assistant is thinking' ) ).toBeVisible();
	} );

	it( 'shows workspace activity while a workspace sync is running', async () => {
		const syncStore = configureStore( {
			reducer: testReducer,
			middleware: ( getDefaultMiddleware ) =>
				getDefaultMiddleware().concat( installedAppsApi.middleware ),
		} );
		const productionSite = createSyncSite( {
			id: 101,
			name: 'Business Plan',
			url: 'https://business-plan.example',
			stagingSiteIds: [ 202 ],
		} );
		const stagingSite = createSyncSite( {
			id: 202,
			name: 'Business Plan Staging',
			url: 'https://business-plan-staging.example',
			isStaging: true,
			productionSiteId: 101,
		} );
		enableWorkspaceSidebar( {
			wpcomSites: [ productionSite, stagingSite ],
		} );
		syncStore.dispatch(
			stagingSyncThunks.startStagingSiteSync.pending( 'request-id', {
				productionSite,
				stagingSite,
				direction: 'push',
				options: [ 'themes' ],
			} )
		);
		expect( syncStore.getState().stagingSync.states[ 101 ] ).toMatchObject( {
			status: 'started',
			stagingSiteId: 202,
		} );

		await act( async () => renderWithProvider( <MainSidebar />, syncStore ) );

		expect( await screen.findByRole( 'button', { name: 'Business Plan' } ) ).toBeVisible();
		expect( screen.getByLabelText( 'Business Plan sync is in progress' ) ).toBeVisible();
	} );

	it( 'renders recent chats under their workspace and selects that workspace chat', async () => {
		const user = userEvent.setup();
		const productionSite = createSyncSite( {
			id: 101,
			name: 'Remote Only',
			url: 'https://remote-only.example',
		} );
		enableWorkspaceSidebar( {
			wpcomSites: [ productionSite ],
		} );
		seedWorkspaceConversation( {
			workspaceId: 'studio-workspace:wpcom:101',
			conversationId: 'workspace-chat-homepage',
			message: 'Edit the homepage hero',
			lastUpdated: Date.UTC( 2026, 4, 16 ),
		} );

		await act( async () => renderWithProvider( <MainSidebar /> ) );

		expect( await screen.findByRole( 'button', { name: 'Remote Only' } ) ).toBeVisible();
		const chatButton = screen.getByRole( 'button', {
			name: 'Open chat: Edit the homepage hero',
		} );
		expect( chatButton ).toBeVisible();

		await user.click( chatButton );

		expect(
			getWorkspaceDollyConversationState( {
				workspaceId: 'studio-workspace:wpcom:101',
				remoteTargets: [],
			} ).id
		).toBe( 'workspace-chat-homepage' );
	} );
} );
