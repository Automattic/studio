import * as ipcHandlers from 'src/ipc-handlers';
import { type BaseTool, successResult, errorResult } from './base-tool';
import type { ToolDefinition, ToolResult } from '../../types';
import type { IpcMainInvokeEvent } from 'electron';

const definition: ToolDefinition = {
	name: 'update_site',
	description: `Update site settings like name, PHP version, custom domain, or HTTPS.

You can update one or more settings at a time. The site ID is provided automatically from the current context.`,
	input_schema: {
		type: 'object' as const,
		properties: {
			name: {
				type: 'string',
				description: 'New name for the site',
			},
			phpVersion: {
				type: 'string',
				description: 'PHP version to use (e.g., "8.2", "8.1", "8.0")',
			},
			customDomain: {
				type: 'string',
				description:
					'Custom domain for the site (e.g., "mysite.local"). Set to empty string to remove.',
			},
			enableHttps: {
				type: 'boolean',
				description: 'Whether to enable HTTPS',
			},
			wpVersion: {
				type: 'string',
				description: 'WordPress version to update to (e.g., "6.4", "nightly")',
			},
		},
		required: [],
	},
};

async function execute( input: Record< string, unknown >, siteId: string ): Promise< ToolResult > {
	if ( ! siteId ) {
		return errorResult( 'No site ID provided. Please select a site first.' );
	}

	// Check if any updates were provided
	const hasUpdates =
		input.name !== undefined ||
		input.phpVersion !== undefined ||
		input.customDomain !== undefined ||
		input.enableHttps !== undefined ||
		input.wpVersion !== undefined;

	if ( ! hasUpdates ) {
		return errorResult(
			'No updates provided. Specify at least one of: name, phpVersion, customDomain, enableHttps, wpVersion'
		);
	}

	try {
		const mockEvent = {} as IpcMainInvokeEvent;

		// Get current site details
		const sites = await ipcHandlers.getSiteDetails( mockEvent );
		const currentSite = sites.find( ( s ) => s.id === siteId );

		if ( ! currentSite ) {
			return errorResult( `Site not found: ${ siteId }` );
		}

		// Build updated site details
		const updatedSite: SiteDetails = {
			...currentSite,
			name: ( input.name as string ) ?? currentSite.name,
			phpVersion: ( input.phpVersion as string ) ?? currentSite.phpVersion,
			customDomain:
				input.customDomain !== undefined
					? ( input.customDomain as string ) || undefined
					: currentSite.customDomain,
			enableHttps:
				input.enableHttps !== undefined
					? ( input.enableHttps as boolean )
					: currentSite.enableHttps,
		};

		const wpVersion = input.wpVersion as string | undefined;

		await ipcHandlers.updateSite( mockEvent, updatedSite, wpVersion );

		const changes: string[] = [];

		if ( input.name !== undefined ) {
			changes.push( `- Name updated to: ${ input.name }` );
		}
		if ( input.phpVersion !== undefined ) {
			changes.push( `- PHP version updated to: ${ input.phpVersion }` );
		}
		if ( input.customDomain !== undefined ) {
			changes.push(
				input.customDomain
					? `- Custom domain set to: ${ input.customDomain }`
					: '- Custom domain removed'
			);
		}
		if ( input.enableHttps !== undefined ) {
			changes.push( `- HTTPS ${ input.enableHttps ? 'enabled' : 'disabled' }` );
		}
		if ( wpVersion !== undefined ) {
			changes.push( `- WordPress version updated to: ${ wpVersion }` );
		}

		return successResult(
			`Site updated successfully!\n\nChanges made:\n${ changes.join( '\n' ) }`
		);
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		return errorResult( `Failed to update site: ${ errorMessage }` );
	}
}

export const updateSiteTool: BaseTool = {
	definition,
	execute,
};
