import { act, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { SiteContentTabs } from 'src/components/site-content-tabs';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { store } from 'src/stores';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';

const selectedSite: SiteDetails = {
	id: 'site-id-1',
	name: 'Test Site',
	running: false,
	path: '/test-site',
	port: 8881,
	phpVersion: '8.4',
};

vi.mock( 'src/hooks/use-site-details' );
vi.mock( 'src/hooks/use-auth', () => ( {
	useAuth: () => ( {
		isAuthenticated: true,
		authenticate: vi.fn(),
	} ),
} ) );
vi.mock( 'src/lib/app-globals', async () => ( {
	...( await vi.importActual( '../../lib/app-globals' ) ),
	getAppGlobals: vi.fn().mockReturnValue( { locale: ' en' } ),
	isWindows: vi.fn().mockReturnValue( false ),
} ) );
vi.mock( 'src/lib/get-ipc-api', async () => ( {
	...( await vi.importActual( '../../lib/get-ipc-api' ) ),
	getIpcApi: vi.fn().mockReturnValue( {
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		updateConnectedWpcomSites: vi.fn(),
		getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
		getUserEditor: vi.fn().mockResolvedValue( 'vscode' ),
		setWindowControlVisibility: vi.fn(),
		isAgenticUiBannerDismissed: vi.fn().mockResolvedValue( true ),
	} ),
} ) );

vi.mock( 'src/stores/wordpress-versions-api', async () => {
	const actual = await vi.importActual( 'src/stores/wordpress-versions-api' );
	return {
		...actual,
		useGetWordPressVersions: vi.fn( () => ( {
			sites: [
				{ label: 'Latest', value: 'latest', isBeta: false, isDevelopment: false },
				{ label: '6.4', value: '6.4', isBeta: false, isDevelopment: false },
				{ label: '6.3', value: '6.3', isBeta: false, isDevelopment: false },
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

store.replaceReducer( testReducer );

describe( 'SiteContentTabs', () => {
	beforeEach( () => {
		vi.clearAllMocks(); // Clear mock call history between tests
		store.dispatch( testActions.resetState() );
	} );
	const renderWithProvider = ( component: React.ReactElement ) => {
		return render(
			<Provider store={ store }>
				<ContentTabsProvider>{ component }</ContentTabsProvider>
			</Provider>
		);
	};
	it( 'should render tabs correctly if selected site exists', async () => {
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			selectedSite,
			sites: [ selectedSite ],
			loadingServer: {},
		} );
		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		expect( screen.getByRole( 'tab', { name: 'Site Settings' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'tab', { name: 'Sync' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'tab', { name: 'Previews' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'tab', { name: 'Import / Export' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'tab', { name: 'Launchpad' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'tab', { name: 'Publish' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'tab', { name: 'Export' } ) ).not.toBeInTheDocument();
	} );
	it( 'selects the Overview tab by default', async () => {
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			selectedSite,
			sites: [ selectedSite ],
			loadingServer: {},
		} );
		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		expect( screen.queryByRole( 'tab', { name: 'Overview', selected: true } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Sync', selected: false } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Previews', selected: false } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Site Settings', selected: false } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Studio Code', selected: false } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'tab', { name: 'Backup', selected: false } )
		).not.toBeInTheDocument();
	} );
} );
