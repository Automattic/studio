import { act, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { SiteContentTabs } from 'src/components/site-content-tabs';
import { SyncSitesProvider } from 'src/hooks/sync-sites';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { store } from 'src/stores';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';

const selectedSite = {
	id: 'site-id-1',
	name: 'Test Site',
	running: false as const,
	path: '/test-site',
};

jest.mock( 'src/hooks/use-site-details' );
jest.mock( 'src/hooks/use-auth', () => ( {
	useAuth: () => ( {
		isAuthenticated: true,
		authenticate: jest.fn(),
	} ),
} ) );
jest.mock( 'src/lib/app-globals', () => ( {
	...jest.requireActual( '../../lib/app-globals' ),
	getAppGlobals: jest.fn().mockReturnValue( { locale: ' en' } ),
	isWindows: jest.fn().mockReturnValue( false ),
} ) );
jest.mock( 'src/lib/get-ipc-api', () => ( {
	...jest.requireActual( '../../lib/get-ipc-api' ),
	getIpcApi: jest.fn().mockReturnValue( {
		getConnectedWpcomSites: jest.fn().mockResolvedValue( [] ),
		updateConnectedWpcomSites: jest.fn(),
		getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
		getUserEditor: jest.fn().mockResolvedValue( 'vscode' ),
		setWindowControlVisibility: jest.fn(),
	} ),
} ) );

jest.mock( 'src/stores/wordpress-versions-api', () => {
	const actual = jest.requireActual( 'src/stores/wordpress-versions-api' );
	return {
		...actual,
		useGetWordPressVersions: jest.fn( () => ( {
			sites: [
				{ label: 'Latest', value: 'latest', isBeta: false, isDevelopment: false },
				{ label: '6.4', value: '6.4', isBeta: false, isDevelopment: false },
				{ label: '6.3', value: '6.3', isBeta: false, isDevelopment: false },
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
			sites: { blueprints: [], total: 0 },
			isLoading: false,
		} ) ),
	};
} );

store.replaceReducer( testReducer );

describe( 'SiteContentTabs', () => {
	beforeEach( () => {
		jest.clearAllMocks(); // Clear mock call history between tests
		store.dispatch( testActions.resetState() );
	} );
	const renderWithProvider = ( component: React.ReactElement ) => {
		return render(
			<Provider store={ store }>
				<ContentTabsProvider>
					<SyncSitesProvider>{ component }</SyncSitesProvider>
				</ContentTabsProvider>
			</Provider>
		);
	};
	it( 'should render tabs correctly if selected site exists', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite,
			snapshots: [],
			sites: [ selectedSite ],
			loadingServer: {},
		} );
		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		expect( screen.getByRole( 'tab', { name: 'Settings' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'tab', { name: 'Sync' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'tab', { name: 'Previews' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'tab', { name: 'Import / Export' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'tab', { name: 'Launchpad' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'tab', { name: 'Publish' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'tab', { name: 'Export' } ) ).not.toBeInTheDocument();
	} );
	it( 'selects the Overview tab by default', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite,
			snapshots: [],
			sites: [ selectedSite ],
			loadingServer: {},
		} );
		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		expect( screen.queryByRole( 'tab', { name: 'Overview', selected: true } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Sync', selected: false } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Previews', selected: false } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Settings', selected: false } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Assistant', selected: false } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'tab', { name: 'Backup', selected: false } )
		).not.toBeInTheDocument();
	} );
} );
