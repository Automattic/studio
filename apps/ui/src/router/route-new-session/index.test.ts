import { describe, expect, it, vi } from 'vitest';
import { newSessionRoute } from './index';

function createContext( agenticFeaturesEnabled: boolean ) {
	return {
		queryClient: {
			fetchQuery: ( { queryFn }: { queryFn: () => unknown } ) => queryFn(),
			setQueryData: vi.fn(),
			invalidateQueries: vi.fn(),
		},
		connector: {
			agenticRequiresAuth: true,
			getAuthUser: async () => null,
			getUserPreferences: async () => ( { agenticFeaturesEnabled } ),
			createSession: vi.fn( async () => ( { id: 'session-1' } ) ),
		},
	};
}

function runBeforeLoad( context: ReturnType< typeof createContext > ) {
	return newSessionRoute.options.beforeLoad?.( {
		context,
		params: { siteId: 'site-1' },
	} as never );
}

describe( 'newSessionRoute.beforeLoad', () => {
	it( 'opens a new chat while signed out of WordPress.com', async () => {
		const context = createContext( true );

		await expect( runBeforeLoad( context ) ).rejects.toMatchObject( {
			options: { to: '/sessions/$sessionId', params: { sessionId: 'session-1' } },
		} );
		expect( context.connector.createSession ).toHaveBeenCalledWith( 'site-1' );
	} );

	it( 'redirects to overview when Studio Code is switched off', async () => {
		const context = createContext( false );

		await expect( runBeforeLoad( context ) ).rejects.toMatchObject( {
			options: { to: '/sites/$siteId', params: { siteId: 'site-1' } },
		} );
		expect( context.connector.createSession ).not.toHaveBeenCalled();
	} );
} );
