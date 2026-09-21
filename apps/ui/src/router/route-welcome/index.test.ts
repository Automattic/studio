import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { welcomeRoute } from './index';

function makeContext( { sites = [] }: { sites?: unknown[] } = {} ) {
	const connector = {
		getSites: vi.fn().mockResolvedValue( sites ),
	};
	return { context: { queryClient: new QueryClient(), connector } };
}

const beforeLoad = welcomeRoute.options.beforeLoad as ( args: {
	context: unknown;
} ) => Promise< void >;

describe( 'welcomeRoute beforeLoad', () => {
	it( 'redirects to the index when sites exist', async () => {
		const { context } = makeContext( { sites: [ { id: 'site-1' } ] } );

		await expect( beforeLoad( { context } ) ).rejects.toMatchObject( {
			options: { to: '/' },
		} );
	} );

	it( 'shows the welcome screen when there are no sites', async () => {
		const { context } = makeContext();

		await expect( beforeLoad( { context } ) ).resolves.toBeUndefined();
	} );
} );
