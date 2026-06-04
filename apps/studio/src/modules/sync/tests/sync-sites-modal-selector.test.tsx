// To run tests, execute `npm run test -- src/modules/sync/tests/sync-sites-modal-selector.test.tsx` from the root directory
import { render, screen } from '@testing-library/react';
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
import { useGetConnectedSitesForLocalSiteQuery } from 'src/stores/sync/connected-sites';
import { useGetWpComSitesQuery } from 'src/stores/sync/wpcom-sites';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';
import type { SitesQueryResult } from 'src/modules/sync/components/sync-sites-modal-selector';

store.replaceReducer( testReducer );

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/hooks/use-auth' );
vi.mock( 'src/hooks/use-offline' );
vi.mock( 'src/stores/sync/wpcom-sites', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('src/stores/sync/wpcom-sites') >();
	return { ...actual, useGetWpComSitesQuery: vi.fn() };
} );
vi.mock( 'src/stores/sync/connected-sites', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('src/stores/sync/connected-sites') >();
	return { ...actual, useGetConnectedSitesForLocalSiteQuery: vi.fn() };
} );

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
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( { openURL: vi.fn() } );
		vi.mocked( useGetConnectedSitesForLocalSiteQuery, { partial: true } ).mockReturnValue( {
			data: [],
		} );
		vi.mocked( useGetWpComSitesQuery, { partial: true } ).mockReturnValue( {
			data: { sites: [], total: 0, page: 1, perPage: 100 },
			isLoading: false,
			isFetching: false,
			isSuccess: true,
			refetch: vi.fn(),
		} );
	} );

	it( 'shows "Find a perfect plan" modal when the account has no sites and no search is active', () => {
		renderWithProvider(
			<SyncSitesModalSelector
				onRequestClose={ vi.fn() }
				onConnect={ vi.fn() }
				selectedSite={ selectedSite }
			/>
		);
		expect( screen.getByText( 'Find a perfect plan' ) ).toBeInTheDocument();
	} );
} );
