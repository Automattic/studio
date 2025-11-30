import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import App from 'src/components/app';
import { SyncSitesProvider } from 'src/hooks/sync-sites';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useOnboarding } from 'src/modules/onboarding/hooks/use-onboarding';
import { rootReducer } from 'src/stores';
import { appVersionApi } from 'src/stores/app-version-api';
import { certificateTrustApi } from 'src/stores/certificate-trust-api';
import { installedAppsApi } from 'src/stores/installed-apps-api';
import { setProviderConstants } from 'src/stores/provider-constants-slice';
import { connectedSitesApi } from 'src/stores/sync/connected-sites';
import { wordpressVersionsApi } from 'src/stores/wordpress-versions-api';
import { wpcomApi, wpcomPublicApi } from 'src/stores/wpcom-api';

jest.mock( 'src/index.css', () => ( {} ) );
jest.mock( 'src/hooks/use-onboarding' );
jest.mock( 'src/hooks/use-site-details' );

jest.mock( 'src/modules/whats-new/hooks/use-whats-new', () => ( {
	useWhatsNew: () => ( {
		showWhatsNew: false,
		closeWhatsNew: jest.fn(),
	} ),
} ) );

jest.mock( 'src/lib/app-globals', () => ( {
	...jest.requireActual( '../../lib/app-globals' ),
	getAppGlobals: jest.fn().mockReturnValue( { locale: 'en' } ),
	isWindows: jest.fn().mockReturnValue( false ),
} ) );
jest.mock( 'src/lib/get-ipc-api', () => ( {
	...jest.requireActual( '../../lib/get-ipc-api' ),
	getIpcApi: jest.fn().mockReturnValue( {
		setupAppMenu: jest.fn(),
		getConnectedWpcomSites: jest.fn().mockResolvedValue( [] ),
		updateConnectedWpcomSites: jest.fn(),
		getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
		getUserEditor: jest.fn().mockResolvedValue( 'vscode' ),
		setWindowControlVisibility: jest.fn(),
		generateProposedSitePath: jest.fn().mockResolvedValue( {
			path: '/default/path',
			name: 'Default Site',
			isEmpty: true,
			isWordPress: false,
		} ),
		getAllCustomDomains: jest.fn().mockResolvedValue( [] ),
	} ),
} ) );

jest.mock( 'src/stores/wordpress-versions-api', () => {
	const actual = jest.requireActual( 'src/stores/wordpress-versions-api' );
	return {
		...actual,
		useGetWordPressVersions: jest.fn( () => ( {
			data: [
				{ label: 'Latest', value: 'latest', isBeta: false, isDevelopment: false },
				{ label: '6.4', value: '6.4', isBeta: false, isDevelopment: false },
			],
			isLoading: false,
		} ) ),
	};
} );

jest.mock( 'src/stores/wpcom-api', () => {
	const actual = jest.requireActual( 'src/stores/wpcom-api' );
	return {
		...actual,
		useGetBlueprints: jest.fn( () => ( {
			data: { blueprints: [], total: 0 },
			isLoading: false,
		} ) ),
	};
} );

describe( 'App', () => {
	beforeEach( () => {
		jest.clearAllMocks();
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
					.concat( connectedSitesApi.middleware ),
		} );
		store.dispatch(
			setProviderConstants( {
				defaultPhpVersion: '8.3',
				defaultWordPressVersion: 'latest',
				allowedPhpVersions: [ '8.0', '8.1', '8.2', '8.3' ],
				minimumWordPressVersion: '6.2.6',
			} )
		);
		return render(
			<Provider store={ store }>
				<ContentTabsProvider>
					<SyncSitesProvider>{ component }</SyncSitesProvider>
				</ContentTabsProvider>
			</Provider>
		);
	};

	it( 'should display EmptyStudio when there are no sites and onboarding is complete', async () => {
		( useOnboarding as jest.Mock ).mockReturnValue( {
			needsOnboarding: false,
		} );
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			data: [],
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
