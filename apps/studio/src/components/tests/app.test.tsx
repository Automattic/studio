import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { vi, type Mock } from 'vitest';
import App from 'src/components/app';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useOnboarding } from 'src/modules/onboarding/hooks/use-onboarding';
import { WorkspaceSelectionProvider } from 'src/modules/workspaces';
import { rootReducer } from 'src/stores';
import { appVersionApi } from 'src/stores/app-version-api';
import { certificateTrustApi } from 'src/stores/certificate-trust-api';
import { installedAppsApi } from 'src/stores/installed-apps-api';
import { connectedSitesApi } from 'src/stores/sync/connected-sites';
import { wpcomSitesApi } from 'src/stores/sync/wpcom-sites';
import { wordpressVersionsApi } from 'src/stores/wordpress-versions-api';
import { wpcomApi, wpcomPublicApi } from 'src/stores/wpcom-api';
import type { SyncSite } from '@studio/common/types/sync';

const featureFlagsMock = vi.hoisted( () => ( {
	enableBlueprints: true,
	enableStudioCodeUi: false,
	enableWorkspaces: false,
} ) );
const useGetWpComSitesQueryMock = vi.hoisted( () => vi.fn() );

vi.mock( 'src/index.css', () => ( {} ) );
vi.mock( 'src/modules/workspaces/components/workspace-dolly-assistant', () => ( {
	WorkspaceDollyAssistant: () => null,
} ) );
vi.mock( 'src/components/dot-grid', () => ( {
	DotGrid: () => null,
} ) );
vi.mock( 'src/components/gravatar', () => ( {
	Gravatar: () => null,
} ) );
vi.mock( 'src/stores/onboarding-slice', async () => {
	const actual = await vi.importActual( 'src/stores/onboarding-slice' );
	return {
		...actual,
		selectOnboardingLoading: vi.fn().mockReturnValue( false ),
	};
} );
vi.mock( 'src/modules/onboarding/hooks/use-onboarding' );
vi.mock( 'src/hooks/use-site-details' );
vi.mock( 'src/hooks/use-auth', () => ( {
	useAuth: () => ( {
		isAuthenticated: true,
		user: { id: 123, email: 'user@example.com', displayName: 'User' },
		client: undefined,
		authenticate: vi.fn(),
		logout: vi.fn(),
	} ),
} ) );
vi.mock( 'src/hooks/use-feature-flags', () => ( {
	useFeatureFlags: () => featureFlagsMock,
} ) );
vi.mock( 'src/modules/whats-new/hooks/use-whats-new', () => ( {
	useWhatsNew: () => ( {
		showWhatsNew: false,
		closeWhatsNew: vi.fn(),
	} ),
} ) );

vi.mock( 'src/lib/app-globals', async () => {
	const actual = await vi.importActual( '../../lib/app-globals' );
	return {
		...actual,
		getAppGlobals: vi.fn().mockReturnValue( { locale: 'en' } ),
		isWindows: vi.fn().mockReturnValue( false ),
	};
} );
vi.mock( 'src/lib/get-ipc-api', async () => {
	const actual = await vi.importActual( '../../lib/get-ipc-api' );
	return {
		...actual,
		getIpcApi: vi.fn().mockReturnValue( {
			setupAppMenu: vi.fn(),
			getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
			updateConnectedWpcomSites: vi.fn(),
			getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
			getUserEditor: vi.fn().mockResolvedValue( 'vscode' ),
			setWindowControlVisibility: vi.fn(),
			generateProposedSitePath: vi.fn().mockResolvedValue( {
				path: '/default/path',
				name: 'Default Site',
				isEmpty: true,
				isWordPress: false,
			} ),
			getAllCustomDomains: vi.fn().mockResolvedValue( [] ),
			generateSiteNameFromList: vi.fn().mockResolvedValue( 'My WordPress Website' ),
			isFullscreen: vi.fn().mockResolvedValue( false ),
		} ),
	};
} );

vi.mock( 'src/stores/wordpress-versions-api', async () => {
	const actual = await vi.importActual( 'src/stores/wordpress-versions-api' );
	return {
		...actual,
		useGetWordPressVersions: vi.fn( () => ( {
			sites: [
				{ label: 'Latest', value: 'latest', isBeta: false, isDevelopment: false },
				{ label: '6.4', value: '6.4', isBeta: false, isDevelopment: false },
			],
			isLoading: false,
		} ) ),
	};
} );

vi.mock( 'src/stores/wpcom-api', async () => {
	const actual = await vi.importActual( 'src/stores/wpcom-api' );
	return {
		...actual,
		useGetBlueprints: vi.fn( () => ( {
			sites: { blueprints: [], total: 0 },
			isLoading: false,
		} ) ),
	};
} );

vi.mock( 'src/stores/sync/wpcom-sites', async () => {
	const actual = await vi.importActual< typeof import('src/stores/sync/wpcom-sites') >(
		'src/stores/sync/wpcom-sites'
	);
	return {
		...actual,
		useGetWpComSitesQuery: useGetWpComSitesQueryMock,
	};
} );

const createSyncSite = ( overrides: Partial< SyncSite > = {} ): SyncSite => ( {
	id: 101,
	localSiteId: '',
	name: 'Remote Only',
	url: 'https://remote-only.example',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
	...overrides,
} );

const mockWpcomSitesQuery = ( sites: SyncSite[] = [] ) => {
	useGetWpComSitesQueryMock.mockReturnValue( {
		data: { sites, total: sites.length, page: 1, perPage: 100 },
		isLoading: false,
		isFetching: false,
	} );
};

describe( 'App', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		featureFlagsMock.enableWorkspaces = false;
		mockWpcomSitesQuery();
	} );

	const renderWithProvider = ( component: React.ReactElement ) => {
		const store = configureStore( {
			reducer: rootReducer,
			middleware: ( getDefaultMiddleware ) =>
				getDefaultMiddleware()
					.concat( appVersionApi.middleware )
					.concat( installedAppsApi.middleware )
					.concat( wordpressVersionsApi.middleware )
					.concat( wpcomApi.middleware )
					.concat( wpcomPublicApi.middleware )
					.concat( certificateTrustApi.middleware )
					.concat( connectedSitesApi.middleware )
					.concat( wpcomSitesApi.middleware ),
		} );
		return render(
			<Provider store={ store }>
				<ContentTabsProvider>
					<WorkspaceSelectionProvider>{ component }</WorkspaceSelectionProvider>
				</ContentTabsProvider>
			</Provider>
		);
	};

	it( 'should display NoStudioSites when there are no sites and onboarding is complete', async () => {
		( useOnboarding as Mock ).mockReturnValue( {
			needsOnboarding: false,
		} );
		( useSiteDetails as Mock ).mockReturnValue( {
			sites: [],
			loadingSites: false,
			selectedSite: null,
			snapshots: [],
			loadingServer: {},
		} );

		renderWithProvider( <App /> );

		await waitFor( () => {
			expect( screen.getByText( 'Add a site' ) ).toBeInTheDocument();
		} );
	} );

	it( 'renders workspace content for remote-only workspaces when enabled', async () => {
		featureFlagsMock.enableWorkspaces = true;
		mockWpcomSitesQuery( [ createSyncSite() ] );
		( useOnboarding as Mock ).mockReturnValue( {
			needsOnboarding: false,
		} );
		( useSiteDetails as Mock ).mockReturnValue( {
			sites: [],
			loadingSites: false,
			selectedSite: null,
			snapshots: [],
			loadingServer: {},
			siteCreationMessages: {},
			setSelectedSiteId: vi.fn(),
		} );

		renderWithProvider( <App /> );

		await waitFor( () => {
			expect( screen.getByTestId( 'site-content' ) ).toBeInTheDocument();
		} );
		expect( screen.getAllByText( 'Remote Only' )[ 0 ] ).toBeVisible();
		expect( screen.queryByText( 'Add a site' ) ).not.toBeInTheDocument();
	} );
} );
