import { describe, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { createTestQueryClient } from '@/test/render';
import { newSessionRoute } from './index';

function setup( exists = true ) {
	const connector = createFakeConnector( {
		sites: exists ? [ makeSite( { id: 'site-1' } ) ] : [],
	} );
	const context = { connector, queryClient: createTestQueryClient() };
	return {
		connector,
		load: () =>
			newSessionRoute.options.beforeLoad?.( { context, params: { siteId: 'site-1' } } as never ),
	};
}

describe( 'newSessionRoute.beforeLoad', () => {
	it( 'opens the site draft without creating or loading a chat', async () => {
		const { connector, load } = setup();
		await load();
		expect( connector.createSession ).not.toHaveBeenCalled();
		expect( connector.getSessions ).not.toHaveBeenCalled();
	} );
	it( 'leaves a site that no longer exists', async () => {
		const { load } = setup( false );
		await expect( load() ).rejects.toMatchObject( { options: { to: '/' } } );
	} );
} );
