import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { describe, expect, it, vi } from 'vitest';
import { createAppRouter } from './router';
import type { RouterContext } from './layout-root';

vi.mock( '@/app/router-history', () => ( {
	createPackagedRouterHistory: () => createMemoryHistory( { initialEntries: [ '/sites' ] } ),
} ) );

describe( 'createAppRouter', () => {
	it( 'keeps a later navigation when a superseded route redirects', async () => {
		let resolvePreferences!: ( preferences: { agenticFeaturesEnabled: boolean } ) => void;
		const connector = {
			agenticRequiresAuth: false,
			getSites: async () => [ { id: 'site-1' } ],
			getAuthUser: async () => null,
			getUserPreferences: () =>
				new Promise( ( resolve ) => {
					resolvePreferences = resolve;
				} ),
		};
		const router = createAppRouter( {
			queryClient: new QueryClient(),
			connector,
		} as unknown as RouterContext );
		await router.load();

		// The new-session route redirects to the site once preferences load, but the site
		// page opens with settings before they do.
		void router.navigate( { to: '/sites/$siteId/new', params: { siteId: 'site-1' } } );
		await vi.waitFor( () => expect( resolvePreferences ).toBeDefined() );
		await router.navigate( {
			to: '/sites/$siteId',
			params: { siteId: 'site-1' },
			search: { settings: 'appearance' },
		} );
		resolvePreferences( { agenticFeaturesEnabled: false } );
		await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );

		expect( router.history.location.href ).toBe( '/sites/site-1?settings=appearance' );
	} );
} );
