import { act, render, screen } from '@testing-library/react';
import { useSiteDetails } from '../../hooks/use-site-details';
import { SiteContentTabs } from '../site-content-tabs';

const selectedSite = {
	id: 'site-id-1',
	name: 'Test Site',
	running: false as const,
	path: '/test-site',
};

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

jest.mock( '../../lib/get-ipc-api' );

describe( 'SiteContentTabs', () => {
	beforeEach( () => {
		jest.clearAllMocks(); // Clear mock call history between tests
	} );
	it( 'should render tabs correctly if selected site exists', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( { selectedSite, snapshots: [] } );
		await act( async () => render( <SiteContentTabs /> ) );
		expect( screen.getByRole( 'tab', { name: 'Settings' } ) ).not.toBeNull();
		expect( screen.getByRole( 'tab', { name: 'Preview' } ) ).not.toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Launchpad' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Publish' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Export' } ) ).toBeNull();
	} );
	it( 'selects the preview tab by default', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( { selectedSite, snapshots: [] } );
		await act( async () => render( <SiteContentTabs /> ) );
		expect( screen.queryByRole( 'tab', { name: 'Preview', selected: true } ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'tab', { name: 'Settings', selected: false } )
		).toBeInTheDocument();
	} );
	it( 'should render a "No Site" screen if selected site is absent', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			undefined,
			snapshots: [],
			data: [],
		} );
		await act( async () => render( <SiteContentTabs /> ) );
		expect( screen.queryByRole( 'tab', { name: 'Settings' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Preview' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Launchpad' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Publish' } ) ).toBeNull();
		expect( screen.queryByRole( 'tab', { name: 'Export' } ) ).toBeNull();
		expect( screen.getByRole( 'button', { name: 'Add site' } ) ).toBeInTheDocument();
	} );
} );
