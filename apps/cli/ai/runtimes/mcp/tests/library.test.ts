import { bindTool } from '@studio/agent/node';
import { describe, expect, it, vi } from 'vitest';
import { cliAgentHost } from 'cli/ai/host';
import { createLibraryTools } from 'cli/ai/runtimes/mcp/library';

vi.mock( '@studio/common/lib/config/store', () => ( {
	readConfig: async () => ( { sites: [ { id: 'a1', name: 'Crumb', path: '/sites/crumb' } ] } ),
} ) );
vi.mock( 'cli/lib/site-utils', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/site-utils') >() ),
	getSitesRunningStatus: async () => new Map( [ [ 'a1', true ] ] ),
} ) );

describe( 'WordPress library', () => {
	it( 'exposes the token entry tool only to the library app', () => {
		const login = createLibraryTools( 'ui://studio/library.html' ).find(
			( { tool } ) => tool.name === 'wpcom_login'
		);
		expect( login?.listing._meta ).toMatchObject( { ui: { visibility: [ 'app' ] } } );
	} );

	it( 'opens from the sidebar with the local sites, for the page only', async () => {
		const [ open ] = createLibraryTools( 'ui://studio/library.html' );

		expect( ( await bindTool( open.tool, cliAgentHost ).rawHandler( {} as never ) )._meta ).toEqual(
			{
				localSites: [ expect.objectContaining( { id: 'a1', running: true } ) ],
			}
		);
		expect( open.listing._meta ).toMatchObject( {
			ui: { visibility: [ 'app' ] },
			'openai/ui': { entrypoints: [ { type: 'global' }, { type: 'thread' } ] },
		} );
	} );
} );
