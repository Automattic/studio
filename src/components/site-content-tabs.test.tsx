import { render } from '@testing-library/react';
import { useSiteDetails } from '../hooks/use-site-details';
import { SiteContentTabs } from './site-content-tabs';

const selectedSite = {
	id: 'site-id-1',
	name: 'Test Site',
	running: false as const,
	path: '/test-site',
};

jest.mock( '../hooks/use-site-details' );
jest.mock( '../hooks/use-auth', () => ( {
	useAuth: () => ( {
		isAuthenticated: true,
		authenticate: jest.fn(),
	} ),
} ) );

jest.mock( '../hooks/use-archive-site', () => ( {
	useArchiveSite: () => ( {
		archiveSite: jest.fn(),
		isUploadingSiteId: jest.fn(),
	} ),
} ) );

jest.mock( '../lib/get-ipc-api' );

describe( 'SiteContentTabs', () => {
	beforeEach( () => {
		jest.clearAllMocks(); // Clear mock call history between tests
	} );
	it( 'should render tabs correctly if selected site exists', () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( { selectedSite, snapshots: [] } );
		const { getByText, queryByText } = render( <SiteContentTabs /> );
		expect( getByText( 'Settings' ) ).not.toBeNull();
		expect( getByText( 'Snapshots' ) ).not.toBeNull();
		expect( queryByText( 'Launchpad' ) ).toBeNull();
		expect( queryByText( 'Publish' ) ).toBeNull();
		expect( queryByText( 'Export' ) ).toBeNull();
	} );
	it( 'should render a "No Site" screen if selected site is absent', () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( { undefined, snapshots: [] } );
		const { queryByText } = render( <SiteContentTabs /> );
		expect( queryByText( 'Settings' ) ).toBeNull();
		expect( queryByText( 'Snapshots' ) ).toBeNull();
		expect( queryByText( 'Launchpad' ) ).toBeNull();
		expect( queryByText( 'Publish' ) ).toBeNull();
		expect( queryByText( 'Export' ) ).toBeNull();
	} );
} );
