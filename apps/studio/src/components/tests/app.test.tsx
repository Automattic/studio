import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { vi, type Mock } from 'vitest';
import App from 'src/components/app';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useOnboarding } from 'src/modules/onboarding/hooks/use-onboarding';
import { rootReducer } from 'src/stores';
import { appVersionApi } from 'src/stores/app-version-api';
import { certificateTrustApi } from 'src/stores/certificate-trust-api';
import { installedAppsApi } from 'src/stores/installed-apps-api';
import { connectedSitesApi } from 'src/stores/sync/connected-sites';
import { wpcomSitesApi } from 'src/stores/sync/wpcom-sites';
import { wordpressVersionsApi } from 'src/stores/wordpress-versions-api';
import { wpcomApi, wpcomPublicApi } from 'src/stores/wpcom-api';

vi.mock( 'src/index.css', () => ( {} ) );
vi.mock( 'src/components/dot-grid', () => ( {
	DotGrid: () => null,
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
vi.mock( 'src/hooks/use-ipc-listener', () => ( {
	useIpcListener: vi.fn(),
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

describe( 'App', () => {
	beforeEach( () => {
		vi.clearAllMocks();
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
				<ContentTabsProvider>{ component }</ContentTabsProvider>
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
} );
