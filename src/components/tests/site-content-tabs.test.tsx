import { act, render, screen } from '@testing-library/react';
import { useFeatureFlags } from '../../hooks/use-feature-flags';
import { useSiteDetails } from '../../hooks/use-site-details';
import { SiteContentTabs } from '../site-content-tabs';

const selectedSite = {
	id: 'site-id-1',
	name: 'Test Site',
	running: false as const,
	path: '/test-site',
};

jest.mock( '../../hooks/use-feature-flags' );
jest.mock( '../../hooks/use-site-details' );
jest.mock( '../../hooks/use-auth', () => ( {
	useAuth: () => ( {
		isAuthenticated: true,
		authenticate: jest.fn(),
	} ),
} ) );
jest.mock( '../../hooks/use-archive-site', () => ( {
	useArchiveSite: () => ( {
		archiveSite: jest.fn(),
		isUploadingSiteId: jest.fn(),
	} ),
} ) );
jest.mock( '../../lib/app-globals', () => ( {
	...jest.requireActual( '../../lib/app-globals' ),
	getAppGlobals: jest.fn().mockReturnValue( { locale: ' en' } ),
} ) );

( useFeatureFlags as jest.Mock ).mockReturnValue( {
	assistantEnabled: false,
} );

describe( 'SiteContentTabs', () => {
	beforeEach( () => {
		jest.clearAllMocks(); // Clear mock call history between tests
	} );
	it( 'should render tabs correctly if selected site exists', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite,
			snapshots: [],
			loadingServer: {},
		} );
		await act( async () => render( <SiteContentTabs /> ) );
		expect( screen.getByRole( 'tab', { name: 'Settings' } ) ).not.toBeNull();
		expect( screen.getByRole( 'tab', { name: 'Share' } ) ).not.toBeNull();
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
		await act( async () => render( <SiteContentTabs /> ) );
		expect( screen.queryByRole( 'tab', { name: 'Overview', selected: true } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Share', selected: false } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Settings', selected: false } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Assistant', selected: false } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Backup', selected: false } ) ).toBeNull();
	} );
	it( 'should render a "No Site" screen if selected site is absent', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			undefined,
			snapshots: [],
			data: [],
			loadingServer: {},
		} );
		await act( async () => render( <SiteContentTabs /> ) );
		expect( screen.queryByRole( 'tab', { name: 'Settings' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Share' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Launchpad' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Publish' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Export' } ) ).toBeNull();
		expect( screen.getByText( 'Select a site to view details.' ) ).toBeVisible();
	} );
	it( 'should not render the Assistant tab if assistantEnabled is not enabled', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite,
			snapshots: [],
			loadingServer: {},
		} );
		await act( async () => render( <SiteContentTabs /> ) );
		expect( screen.queryByRole( 'tab', { name: 'Assistant' } ) ).toBeNull();
	} );

	it( 'should render the Assistant tab if assistantEnabled is enabled', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite,
			snapshots: [],
			loadingServer: {},
		} );
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			assistantEnabled: true,
		} );
		await act( async () => render( <SiteContentTabs /> ) );
		expect( screen.queryByRole( 'tab', { name: 'Assistant' } ) ).toBeVisible();
	} );
} );
