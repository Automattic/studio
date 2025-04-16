import { act, render, screen } from '@testing-library/react';
import { SiteContentTabs } from 'src/components/site-content-tabs';
import { SyncSitesProvider } from 'src/hooks/sync-sites';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useSiteDetails } from 'src/hooks/use-site-details';

const selectedSite = {
	id: 'site-id-1',
	name: 'Test Site',
	running: false as const,
	path: '/test-site',
};

jest.mock( 'src/hooks/use-feature-flags' );
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
} ) );
jest.mock( 'src/lib/get-ipc-api', () => ( {
	...jest.requireActual( '../../lib/get-ipc-api' ),
	getIpcApi: jest.fn().mockReturnValue( {
		getConnectedWpcomSites: jest.fn().mockResolvedValue( [] ),
		updateConnectedWpcomSites: jest.fn(),
	} ),
} ) );

( useFeatureFlags as jest.Mock ).mockReturnValue( {} );

describe( 'SiteContentTabs', () => {
	beforeEach( () => {
		jest.clearAllMocks(); // Clear mock call history between tests
	} );
	const renderWithProvider = ( component: React.ReactElement ) => {
		return render(
			<ContentTabsProvider>
				<SyncSitesProvider>{ component }</SyncSitesProvider>
			</ContentTabsProvider>
		);
	};
	it( 'should render tabs correctly if selected site exists', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite,
			snapshots: [],
			loadingServer: {},
		} );
		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		expect( screen.getByRole( 'tab', { name: 'Settings' } ) ).not.toBeNull();
		expect( screen.getByRole( 'tab', { name: 'Sync' } ) ).not.toBeNull();
		expect( screen.getByRole( 'tab', { name: 'Previews' } ) ).not.toBeNull();
		expect( screen.getByRole( 'tab', { name: 'Import / Export' } ) ).not.toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Launchpad' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Publish' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Export' } ) ).toBeNull();
	} );
	it( 'selects the Overview tab by default', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite,
			snapshots: [],
			loadingServer: {},
		} );
		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		expect( screen.queryByRole( 'tab', { name: 'Overview', selected: true } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Sync', selected: false } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Previews', selected: false } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Settings', selected: false } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Assistant', selected: false } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Backup', selected: false } ) ).toBeNull();
	} );
	it( 'should render a "No Site" screen if selected site is absent', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			undefined,
			snapshots: [],
			data: [],
			loadingServer: {},
		} );
		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		expect( screen.queryByRole( 'tab', { name: 'Settings' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Sync' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Previews' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Launchpad' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Publish' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Export' } ) ).toBeNull();
		expect( screen.getByText( 'Select a site to view details.' ) ).toBeVisible();
	} );
} );
