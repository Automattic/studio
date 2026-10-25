import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { noSitesRoute } from './index';
import type { SiteDetails } from '@/data/core';

const { navigate, openAddSite, state } = vi.hoisted( () => ( {
	navigate: vi.fn(),
	openAddSite: vi.fn(),
	state: {
		search: {} as Record< string, unknown >,
		sites: [] as SiteDetails[],
	},
} ) );

vi.mock( '@tanstack/react-router', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	useNavigate: () => navigate,
	useSearch: () => state.search,
} ) );
vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: () => ( { data: state.sites, isSuccess: true, isError: false } ),
} ) );
vi.mock( '@/features/sites', () => ( { useOpenAddSite: () => openAddSite } ) );
vi.mock( '@/features/sidebar', () => ( { HeaderSidebarToggle: () => null } ) );
vi.mock( '@/data/host/use-traffic-light-space', () => ( {
	useTrafficLightSpace: () => ( { start: false } ),
} ) );
vi.mock( '../layout-dashboard', () => ( { dashboardLayoutRoute: {} } ) );

const NoSites = noSitesRoute.options.component!;

describe( 'the empty workspace', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		state.search = {};
		state.sites = [];
	} );

	it( 'offers Add site once, after the welcome', () => {
		state.search = { welcome: true };
		const { rerender } = render( <NoSites /> );
		expect( openAddSite ).not.toHaveBeenCalled();

		state.search = {};
		rerender( <NoSites /> );
		expect( openAddSite ).toHaveBeenCalledTimes( 1 );

		state.search = { addSite: 'create' };
		rerender( <NoSites /> );
		state.search = {};
		rerender( <NoSites /> );
		expect( openAddSite ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'leaves for the sites when one appears', () => {
		const { rerender } = render( <NoSites /> );

		state.sites = [ { id: 'new-site', name: 'New site' } as SiteDetails ];
		rerender( <NoSites /> );

		expect( navigate ).toHaveBeenCalledWith( { to: '/', search: true, replace: true } );
	} );
} );
