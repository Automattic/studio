import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Menu from '@/components/menu';
import { MainView } from './main-view';
import type { SiteDetails } from '@/data/core';
import type { SyncActivity } from '@/data/sync-activity';

const { connector, transitions, startSiteMutate, stopSiteMutate } = vi.hoisted( () => ( {
	connector: {
		openExternalUrl: vi.fn(),
	},
	transitions: { starting: false, stopping: false },
	startSiteMutate: vi.fn(),
	stopSiteMutate: vi.fn(),
} ) );

vi.mock( '@/components/open-in-menu/use-open-in-destinations', () => ( {
	useOpenInDestinations: () => [],
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => connector,
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useIsSiteBusy: () => transitions.starting || transitions.stopping,
	useIsSiteStarting: () => transitions.starting,
	useIsSiteStopping: () => transitions.stopping,
	useSiteOperation: () => null,
	useStartSite: () => ( { mutate: startSiteMutate } ),
	useStopSite: () => ( { mutate: stopSiteMutate } ),
} ) );

const site: SiteDetails = {
	id: 'site-1',
	name: 'Demo Site',
	path: '/tmp/demo-site',
	port: 8881,
	running: true,
	phpVersion: '8.3',
};

function mainViewTree( {
	siteOverrides = {},
	activity = null,
}: {
	siteOverrides?: Partial< SiteDetails >;
	activity?: SyncActivity | null;
} = {} ) {
	// MainView renders menu items, which need the Menu.Root + Popup contexts the
	// dropdown provides around it in the real app.
	return (
		<Menu.Root open>
			<Menu.Popup>
				<MainView site={ { ...site, ...siteOverrides } } activity={ activity } />
			</Menu.Popup>
		</Menu.Root>
	);
}

function renderMainView( options: Parameters< typeof mainViewTree >[ 0 ] = {} ) {
	return render( mainViewTree( options ) );
}

describe( 'MainView', () => {
	beforeEach( () => {
		connector.openExternalUrl.mockReset();
		startSiteMutate.mockReset();
		stopSiteMutate.mockReset();
		transitions.starting = false;
		transitions.stopping = false;
	} );

	it( 'shows an Xdebug badge on the Studio row only when Xdebug is enabled', () => {
		const { unmount } = renderMainView( { siteOverrides: { enableXdebug: true } } );

		expect( screen.getByRole( 'img', { name: 'Xdebug enabled' } ) ).toBeInTheDocument();

		unmount();
		renderMainView();

		expect( screen.queryByRole( 'img', { name: 'Xdebug enabled' } ) ).not.toBeInTheDocument();
	} );

	it( 'labels the site status toggle with the status and the action it performs', () => {
		const { unmount } = renderMainView();

		const running = screen.getByRole( 'switch', { name: 'Site status: Running. Stop site' } );
		expect( running ).toBeChecked();
		fireEvent.click( running );
		expect( stopSiteMutate ).toHaveBeenCalledWith( site.id );

		unmount();
		renderMainView( { siteOverrides: { running: false } } );

		const stopped = screen.getByRole( 'switch', { name: 'Site status: Stopped. Start site' } );
		expect( stopped ).not.toBeChecked();
		fireEvent.click( stopped );
		expect( startSiteMutate ).toHaveBeenCalledWith( site.id );
	} );

	it( 'reports the pending status on the site status toggle without acting on clicks', () => {
		transitions.starting = true;

		const { unmount } = renderMainView( { siteOverrides: { running: false } } );

		const starting = screen.getByRole( 'switch', { name: 'Site status: Starting' } );
		expect( starting ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( starting ).toBeChecked();
		fireEvent.click( starting );
		expect( startSiteMutate ).not.toHaveBeenCalled();

		unmount();
		transitions.starting = false;
		transitions.stopping = true;
		renderMainView();

		const stopping = screen.getByRole( 'switch', { name: 'Site status: Stopping' } );
		expect( stopping ).not.toBeChecked();
		fireEvent.click( stopping );
		expect( stopSiteMutate ).not.toHaveBeenCalled();
	} );

	it( 'shows detailed import progress in the open site status', () => {
		renderMainView( {
			activity: { kind: 'pending', direction: 'import', message: '24% · Media uploads…' },
		} );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Importing backup…' );
		expect( screen.getByRole( 'status' ) ).toHaveTextContent( '24% · Media uploads…' );
	} );
} );
