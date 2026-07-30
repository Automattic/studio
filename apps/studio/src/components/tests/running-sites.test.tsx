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

	it( 'should show "Start all" when no sites are running', () => {
		mockSiteDetails( { sites: [ stoppedSite( '1' ), stoppedSite( '2' ) ] } );
		render( <RunningSites /> );
		expect( screen.getByText( 'Start all' ) ).toBeInTheDocument();
		expect( screen.getByText( 'No sites running' ) ).toBeInTheDocument();
	} );

	it( 'should show "Start" when a single site is stopped', () => {
		mockSiteDetails( { sites: [ stoppedSite( '1' ) ] } );
		render( <RunningSites /> );
		expect( screen.getByText( 'Start' ) ).toBeInTheDocument();
	} );

	it( 'should call startAllStoppedSites when Start all is clicked', async () => {
		mockSiteDetails( { sites: [ stoppedSite( '1' ), stoppedSite( '2' ) ] } );
		render( <RunningSites /> );
		const user = userEvent.setup();
		await user.click( screen.getByText( 'Start all' ) );
		expect( mockStartAllStoppedSites ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'should disable Start all while sites are loading', () => {
		mockSiteDetails( {
			sites: [ stoppedSite( '1' ), stoppedSite( '2' ) ],
			loadingServer: { '1': true },
		} );
		render( <RunningSites /> );
		expect( screen.getByText( 'Start all' ).closest( 'button' ) ).toBeDisabled();
	} );

	it( 'should show "Stop" for a single running site', () => {
		mockSiteDetails( { sites: [ runningSite( '1' ) ] } );
		render( <RunningSites /> );
		expect( screen.getByText( 'Stop' ) ).toBeInTheDocument();
		expect( screen.getByText( '1 site running' ) ).toBeInTheDocument();
	} );

	it( 'should show "Stop all" for multiple running sites', () => {
		mockSiteDetails( { sites: [ runningSite( '1' ), runningSite( '2' ) ] } );
		render( <RunningSites /> );
		expect( screen.getByText( 'Stop all' ) ).toBeInTheDocument();
		expect( screen.getByText( '2 sites running' ) ).toBeInTheDocument();
	} );

	it( 'should call stopAllRunningSites when Stop all is clicked', async () => {
		mockSiteDetails( { sites: [ runningSite( '1' ), runningSite( '2' ) ] } );
		render( <RunningSites /> );
		const user = userEvent.setup();
		await user.click( screen.getByText( 'Stop all' ) );
		expect( mockStopAllRunningSites ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'should show "Stop all" in mixed state (some running, some stopped)', () => {
		mockSiteDetails( { sites: [ runningSite( '1' ), stoppedSite( '2' ) ] } );
		render( <RunningSites /> );
		expect( screen.getByText( 'Stop' ) ).toBeInTheDocument();
		expect( screen.getByText( '1 site running' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Start' ) ).not.toBeInTheDocument();
	} );

	it( 'should exclude isAddingSite sites from real sites count', () => {
		mockSiteDetails( {
			sites: [ { ...stoppedSite( '1' ), isAddingSite: true }, stoppedSite( '2' ) ],
		} );
		render( <RunningSites /> );
		expect( screen.getByText( 'Start' ) ).toBeInTheDocument();
	} );
} );
