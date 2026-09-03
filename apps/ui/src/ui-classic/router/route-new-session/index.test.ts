import { describe, expect, it, vi } from 'vitest';
import { newSessionRoute } from './index';

function createContext( {
	agenticRequiresAuth,
	agenticFeaturesEnabled = true,
}: {
	agenticRequiresAuth: boolean;
	agenticFeaturesEnabled?: boolean;
} ) {
	return {
		queryClient: {
			fetchQuery: ( { queryFn }: { queryFn: () => unknown } ) => queryFn(),
		},
		connector: {
			agenticRequiresAuth,
			getAuthUser: async () => null,
			getUserPreferences: async () => ( { agenticFeaturesEnabled } ),
			createSession: vi.fn( async () => ( { id: 'session-1' } ) ),
		},
	};
}

describe( 'newSessionRoute.beforeLoad', () => {
	it( 'leaves the route open for the signed-out Studio Code prompt', async () => {
		const context = createContext( { agenticRequiresAuth: true } );

		await expect(
			newSessionRoute.options.beforeLoad?.( {
				context,
				params: { siteId: 'site-1' },
			} as never )
		).resolves.toBeUndefined();
		expect( context.connector.createSession ).not.toHaveBeenCalled();
	} );

	it( 'redirects to overview when Studio Code is switched off', async () => {
		const context = createContext( {
			agenticRequiresAuth: false,
			agenticFeaturesEnabled: false,
		} );

		await expect(
			newSessionRoute.options.beforeLoad?.( {
				context,
				params: { siteId: 'site-1' },
			} as never )
		).rejects.toMatchObject( {
			options: {
				to: '/sites/$siteId/overview',
				params: { siteId: 'site-1' },
			},
		} );
	} );
} );
