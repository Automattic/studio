import * as ipcHandlers from 'src/ipc-handlers';
import { type BaseTool, successResult, errorResult } from './base-tool';
import type { ToolDefinition, ToolResult } from '../../types';
import type { IpcMainInvokeEvent } from 'electron';

const definition: ToolDefinition = {
	name: 'create_site',
	description: `Create a new WordPress site. This will create a new site with the specified name and optional configuration.

The site will be created in the default Studio sites directory. You can specify:
- Site name (required)
- WordPress version
- PHP version
- Custom domain
- Whether to enable HTTPS`,
	input_schema: {
		type: 'object' as const,
		properties: {
			siteName: {
				type: 'string',
				description: 'The name of the site to create',
			},
			wpVersion: {
				type: 'string',
				description:
					'WordPress version to install (e.g., "6.4", "6.3.2", or "nightly" for latest development version)',
			},
			phpVersion: {
				type: 'string',
				description: 'PHP version to use (e.g., "8.2", "8.1", "8.0")',
			},
			customDomain: {
				type: 'string',
				description: 'Custom domain for the site (e.g., "mysite.local")',
			},
			enableHttps: {
				type: 'boolean',
				description: 'Whether to enable HTTPS for the site',
			},
		},
		required: [ 'siteName' ],
	},
};

async function execute(
	input: Record< string, unknown >,
	_siteId: string // Not used for create
): Promise< ToolResult > {
	const siteName = input.siteName as string;

	if ( ! siteName || typeof siteName !== 'string' ) {
		return errorResult( 'Site name is required and must be a string' );
	}

	try {
		const mockEvent = {} as IpcMainInvokeEvent;

		// Generate a path for the site
		const pathResult = await ipcHandlers.generateProposedSitePath( mockEvent, siteName );

		if ( pathResult.isWordPress ) {
			return errorResult(
				`A WordPress site already exists at ${ pathResult.path }. Please choose a different name.`
			);
		}

		// Create the site
		const config = {
			siteName,
			wpVersion: input.wpVersion as string | undefined,
			phpVersion: input.phpVersion as string | undefined,
			customDomain: input.customDomain as string | undefined,
			enableHttps: input.enableHttps as boolean | undefined,
		};

		const site = await ipcHandlers.createSite( mockEvent, pathResult.path, config );

		const details = [
			`Site created successfully!`,
			``,
			`Name: ${ site.name }`,
			`ID: ${ site.id }`,
			`Path: ${ site.path }`,
		];

		if ( site.running && 'url' in site ) {
			details.push( `URL: ${ site.url }` );
		}

		if ( site.phpVersion ) {
			details.push( `PHP Version: ${ site.phpVersion }` );
		}

		return successResult( details.join( '\n' ) );
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		return errorResult( `Failed to create site: ${ errorMessage }` );
	}
}

export const createSiteTool: BaseTool = {
	definition,
	execute,
};
