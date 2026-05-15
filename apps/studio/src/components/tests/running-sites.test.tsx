import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { vi } from 'vitest';
import { RunningSites } from 'src/components/running-sites';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { createMock } from 'src/lib/test-utils';

vi.mock( 'src/hooks/use-site-details' );

vi.mock( '@wordpress/react-i18n', () => ( {
	useI18n: () => ( {
		__: ( text: string ) => text,
		_n: ( single: string, plural: string, count: number ) => ( count === 1 ? single : plural ),
	} ),
} ) );

const mockStopAllRunningSites = vi.fn();
const mockStartAllStoppedSites = vi.fn();

function mockSiteDetails( overrides: Partial< ReturnType< typeof useSiteDetails > > ) {
	vi.mocked( useSiteDetails ).mockReturnValue(
		createMock< ReturnType< typeof useSiteDetails > >( {
			sites: [],
			stopAllRunningSites: mockStopAllRunningSites,
			startAllStoppedSites: mockStartAllStoppedSites,
			loadingServer: {},
			...overrides,
		} )
	);
}

const runningSite = ( id: string ) => ( {
	id,
	name: `Site ${ id }`,
	path: `/path/${ id }`,
	port: 8881,
	phpVersion: '8.4',
	running: true as const,
	url: `http://localhost:8881`,
} );

const stoppedSite = ( id: string ) => ( {
	id,
	name: `Site ${ id }`,
	path: `/path/${ id }`,
	port: 8881,
	phpVersion: '8.4',
	running: false as const,
} );

describe( 'RunningSites', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'should render nothing when there are no sites', () => {
		mockSiteDetails( { sites: [] } );
		const { container } = render( <RunningSites /> );
		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'should render nothing when all sites are being added', () => {
		mockSiteDetails( {
			sites: [ { ...stoppedSite( '1' ), isAddingSite: true } ],
		} );
		const { container } = render( <RunningSites /> );
		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'should show "Start local sites" when no local sites are running', () => {
		mockSiteDetails( { sites: [ stoppedSite( '1' ), stoppedSite( '2' ) ] } );
		render( <RunningSites /> );
		expect( screen.getByText( 'Start local sites' ) ).toBeInTheDocument();
		expect( screen.getByText( 'No local sites running' ) ).toBeInTheDocument();
	} );

	it( 'should show "Start local" when a single local site is stopped', () => {
		mockSiteDetails( { sites: [ stoppedSite( '1' ) ] } );
		render( <RunningSites /> );
		expect( screen.getByText( 'Start local' ) ).toBeInTheDocument();
	} );

	it( 'should call startAllStoppedSites when Start local sites is clicked', async () => {
		mockSiteDetails( { sites: [ stoppedSite( '1' ), stoppedSite( '2' ) ] } );
		render( <RunningSites /> );
		const user = userEvent.setup();
		await user.click( screen.getByText( 'Start local sites' ) );
		expect( mockStartAllStoppedSites ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'should disable Start local sites while sites are loading', () => {
		mockSiteDetails( {
			sites: [ stoppedSite( '1' ), stoppedSite( '2' ) ],
			loadingServer: { '1': true },
		} );
		render( <RunningSites /> );
		expect( screen.getByText( 'Start local sites' ).closest( 'button' ) ).toBeDisabled();
	} );

	it( 'should show "Stop local" for a single running local site', () => {
		mockSiteDetails( { sites: [ runningSite( '1' ) ] } );
		render( <RunningSites /> );
		expect( screen.getByText( 'Stop local' ) ).toBeInTheDocument();
		expect( screen.getByText( '1 local site running' ) ).toBeInTheDocument();
	} );

	it( 'should show "Stop local sites" for multiple running local sites', () => {
		mockSiteDetails( { sites: [ runningSite( '1' ), runningSite( '2' ) ] } );
		render( <RunningSites /> );
		expect( screen.getByText( 'Stop local sites' ) ).toBeInTheDocument();
		expect( screen.getByText( '2 local sites running' ) ).toBeInTheDocument();
	} );

	it( 'should call stopAllRunningSites when Stop local sites is clicked', async () => {
		mockSiteDetails( { sites: [ runningSite( '1' ), runningSite( '2' ) ] } );
		render( <RunningSites /> );
		const user = userEvent.setup();
		await user.click( screen.getByText( 'Stop local sites' ) );
		expect( mockStopAllRunningSites ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'should show "Stop local" in mixed state (some running, some stopped)', () => {
		mockSiteDetails( { sites: [ runningSite( '1' ), stoppedSite( '2' ) ] } );
		render( <RunningSites /> );
		expect( screen.getByText( 'Stop local' ) ).toBeInTheDocument();
		expect( screen.getByText( '1 local site running' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Start local' ) ).not.toBeInTheDocument();
	} );

	it( 'should exclude isAddingSite sites from real sites count', () => {
		mockSiteDetails( {
			sites: [ { ...stoppedSite( '1' ), isAddingSite: true }, stoppedSite( '2' ) ],
		} );
		render( <RunningSites /> );
		expect( screen.getByText( 'Start local' ) ).toBeInTheDocument();
	} );
} );
