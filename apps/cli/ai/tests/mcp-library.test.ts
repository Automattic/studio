import { describe, expect, it, vi } from 'vitest';
import { createLibraryTools, libraryListing } from 'cli/ai/mcp-library';

vi.mock( 'cli/lib/cli-config/core', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/cli-config/core') >() ),
	readCliConfig: async () => ( {
		sites: [
			{ id: 'a1', name: 'Crumb & Co', path: '/sites/crumb', port: 8881, phpVersion: '8.3' },
		],
	} ),
} ) );
vi.mock( 'cli/lib/site-utils', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/site-utils') >() ),
	getSitesRunningStatus: async () => new Map( [ [ 'a1', true ] ] ),
} ) );

describe( 'WordPress library', () => {
	it( 'opens from the sidebar with the local sites for the page only', async () => {
		const [ open ] = createLibraryTools();
		const result = await open.rawHandler( {} as never );

		expect( result._meta ).toEqual( {
			localSites: [ expect.objectContaining( { id: 'a1', name: 'Crumb & Co', running: true } ) ],
		} );
		expect( libraryListing( open.name ) ).toMatchObject( {
			title: 'WordPress',
			_meta: {
				ui: { visibility: [ 'app' ] },
				'openai/ui': { entrypoints: [ { type: 'global' }, { type: 'thread' } ] },
			},
		} );
	} );
} );
