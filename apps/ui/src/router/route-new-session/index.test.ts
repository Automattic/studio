import { describe, expect, it, vi } from 'vitest';
import { newSessionRoute } from './index';

function createContext( sessions: object[] = [] ) {
	return {
		queryClient: {
			fetchQuery: ( { queryFn }: { queryFn: () => unknown } ) => queryFn(),
			setQueryData: vi.fn(),
			invalidateQueries: vi.fn(),
		},
		connector: {
			agenticRequiresAuth: true,
			getAuthUser: async () => null,
			getSessions: async () => sessions,
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
		const context = createContext();

		await expect( runBeforeLoad( context ) ).rejects.toMatchObject( {
			options: { to: '/sessions/$sessionId', params: { sessionId: 'session-1' } },
		} );
		expect( context.connector.createSession ).toHaveBeenCalledWith( 'site-1' );
	} );

	it( 'reopens the site’s empty chat instead of creating another one', async () => {
		const context = createContext( [
			{ id: 'other-site', ownerSiteId: 'site-2' },
			{ id: 'started', ownerSiteId: 'site-1', firstPrompt: 'Hello' },
			{ id: 'empty', ownerSiteId: 'site-1' },
		] );

		await expect( runBeforeLoad( context ) ).rejects.toMatchObject( {
			options: { to: '/sessions/$sessionId', params: { sessionId: 'empty' } },
		} );
		expect( context.connector.createSession ).not.toHaveBeenCalled();
	} );
} );
