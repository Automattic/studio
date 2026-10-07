import { describe, expect, it, vi } from 'vitest';
import { createLibraryTools } from 'cli/ai/runtimes/mcp/library';

vi.mock( 'cli/lib/cli-config/core', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/cli-config/core') >() ),
	readCliConfig: async () => ( { sites: [ { id: 'a1', name: 'Crumb', path: '/sites/crumb' } ] } ),
} ) );
vi.mock( 'cli/lib/site-utils', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/site-utils') >() ),
	getSitesRunningStatus: async () => new Map( [ [ 'a1', true ] ] ),
} ) );

describe( 'WordPress library', () => {
	it( 'opens from the sidebar with the local sites, for the page only', async () => {
		const [ open ] = createLibraryTools( 'ui://studio/library.html' );

		expect( ( await open.tool.rawHandler( {} as never ) )._meta ).toEqual( {
			localSites: [ expect.objectContaining( { id: 'a1', running: true } ) ],
		} );
		expect( open.listing._meta ).toMatchObject( {
			ui: { visibility: [ 'app' ] },
			'openai/ui': { entrypoints: [ { type: 'global' }, { type: 'thread' } ] },
		} );
	} );
} );
