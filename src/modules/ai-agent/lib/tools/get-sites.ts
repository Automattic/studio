import * as ipcHandlers from 'src/ipc-handlers';
import { type BaseTool, successResult, errorResult } from './base-tool';
import type { ToolDefinition, ToolResult } from '../../types';
import type { IpcMainInvokeEvent } from 'electron';

const definition: ToolDefinition = {
	name: 'get_sites',
	description: `Get a list of all WordPress sites managed by Studio.

Returns information about each site including:
- Site name and ID
- File path
- Running status
- URL (if running)
- PHP version
- Custom domain (if configured)`,
	input_schema: {
		type: 'object' as const,
		properties: {},
		required: [],
	},
};

async function execute(
	_input: Record< string, unknown >,
	_siteId: string
): Promise< ToolResult > {
	try {
		const mockEvent = {} as IpcMainInvokeEvent;
		const sites = await ipcHandlers.getSiteDetails( mockEvent );

		if ( sites.length === 0 ) {
			return successResult( 'No sites found. Use create_site to create a new WordPress site.' );
		}

		const siteList = sites.map( ( site ) => {
			const lines = [
				`## ${ site.name }`,
				`- ID: ${ site.id }`,
				`- Path: ${ site.path }`,
				`- Status: ${ site.running ? 'Running' : 'Stopped' }`,
			];

			if ( site.running && site.url ) {
				lines.push( `- URL: ${ site.url }` );
			}

			if ( site.phpVersion ) {
				lines.push( `- PHP Version: ${ site.phpVersion }` );
			}

			if ( site.customDomain ) {
				lines.push( `- Custom Domain: ${ site.customDomain }` );
			}

			if ( site.enableHttps ) {
				lines.push( `- HTTPS: Enabled` );
			}

			return lines.join( '\n' );
		} );

		return successResult( `Found ${ sites.length } site(s):\n\n${ siteList.join( '\n\n' ) }` );
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		return errorResult( `Failed to get sites: ${ errorMessage }` );
	}
}

export const getSitesTool: BaseTool = {
	definition,
	execute,
};
