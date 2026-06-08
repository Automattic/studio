// To run tests, execute `npm run test -- src/modules/sync/tests/sync-sites-modal-selector.test.tsx` from the root directory
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { render, screen } from '@testing-library/react';
import nock from 'nock';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	SitesListContent,
	SyncSitesModalSelector,
} from 'src/modules/sync/components/sync-sites-modal-selector';
import { store } from 'src/stores';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';
import { setWpcomClient } from 'src/stores/wpcom-api';
import type { SitesQueryResult } from 'src/modules/sync/components/sync-sites-modal-selector';

store.replaceReducer( testReducer );

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/hooks/use-auth' );
vi.mock( 'src/hooks/use-offline' );

const selectedSite: SiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	adminPassword: btoa( 'test-password' ),
	running: false,
	phpVersion: '8.4',
	id: 'site-id',
};

function makeSitesQuery( overrides: Partial< SitesQueryResult > = {} ): SitesQueryResult {
	return {
		sites: [],
		total: 0,
		isLoading: false,
		isFetching: false,
		isSuccess: true,
		searchQuery: '',
		setSearchQuery: vi.fn(),
		refetch: vi.fn(),
		...overrides,
	};
}

const renderWithProvider = ( children: React.ReactElement ) =>
	render( <Provider store={ store }>{ children }</Provider> );

describe( 'SitesListContent', () => {
	beforeEach( () => {
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( { openURL: vi.fn() } );
	} );

	it( 'shows localized empty message when search query yields no results', () => {
		renderWithProvider(
			<SitesListContent
				sitesQuery={ makeSitesQuery( { searchQuery: 'lorem ipsum' } ) }
				selectedSiteId={ null }
				onSelectSite={ vi.fn() }
			/>
		);
		expect( screen.getByText( 'No sites found for "lorem ipsum"' ) ).toBeInTheDocument();
	} );

	it( 'shows generic empty message when no search query is active', () => {
		renderWithProvider(
			<SitesListContent
				sitesQuery={ makeSitesQuery( { searchQuery: '' } ) }
				selectedSiteId={ null }
				onSelectSite={ vi.fn() }
			/>
		);
		expect(
			screen.getByText( 'No WordPress.com sites found on this account.' )
		).toBeInTheDocument();
	} );
} );

describe( 'SyncSitesModalSelector', () => {
	beforeEach( () => {
		store.dispatch( testActions.resetState() );
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
			isAuthenticated: true,
			authenticate: vi.fn(),
			user: { id: 123, email: 'user@example.com', displayName: 'user' },
			client: {} as never,
		} );
		vi.mocked( useOffline ).mockReturnValue( false );
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			openURL: vi.fn(),
			getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
			updateConnectedWpcomSites: vi.fn().mockResolvedValue( undefined ),
		} );
		setWpcomClient( wpcomFactory( 'mock-token', wpcomXhrRequest ) );
		nock( 'https://public-api.wordpress.com' )
			.get( '/rest/v1.3/me/sites' )
			.query( true )
			.reply( 200, { sites: [], total: 0 } );
	} );

	afterEach( () => {
		setWpcomClient( undefined );
	} );

	it( 'shows "Find a perfect plan" modal when the account has no sites and no search is active', async () => {
		renderWithProvider(
			<SyncSitesModalSelector
				onRequestClose={ vi.fn() }
				onConnect={ vi.fn() }
				selectedSite={ selectedSite }
			/>
		);
		expect( await screen.findByText( 'Find a perfect plan' ) ).toBeInTheDocument();
	} );
} );
