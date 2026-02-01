import { SiteServer } from 'src/site-server';
import { type BaseTool, successResult, errorResult } from './base-tool';
import type { ToolDefinition, ToolResult } from '../../types';

const definition: ToolDefinition = {
	name: 'get_theme_details',
	description: `Get detailed information about the currently active theme on the WordPress site.

Returns:
- Theme name and slug
- Whether it's a block theme (Full Site Editing)
- Theme path
- Thumbnail if available`,
	input_schema: {
		type: 'object' as const,
		properties: {},
		required: [],
	},
};

async function execute( _input: Record< string, unknown >, siteId: string ): Promise< ToolResult > {
	if ( ! siteId ) {
		return errorResult( 'No site ID provided. Please select a site first.' );
	}

	try {
		const server = SiteServer.get( siteId );
		if ( ! server ) {
			return errorResult( 'Site not found. Make sure the site exists.' );
		}

		if ( ! server.details.running ) {
			return errorResult( 'Site is not running. Start the site first to get theme details.' );
		}

		const themeDetails = await server.getThemeDetails();

		if ( ! themeDetails ) {
			return successResult( 'No theme details available. The site may not have an active theme.' );
		}

		const details = [
			`## Active Theme Details`,
			``,
			`- Name: ${ themeDetails.name }`,
			`- Slug: ${ themeDetails.slug }`,
			`- Type: ${ themeDetails.isBlockTheme ? 'Block Theme (FSE)' : 'Classic Theme' }`,
			`- Path: ${ themeDetails.path }`,
		];

		if ( themeDetails.isBlockTheme ) {
			details.push(
				``,
				`This is a Full Site Editing (FSE) theme. It uses block templates and template parts for layout.`
			);
		} else {
			details.push(
				``,
				`This is a classic PHP theme. It uses PHP template files like header.php, footer.php, etc.`
			);
		}

		return successResult( details.join( '\n' ) );
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		return errorResult( `Failed to get theme details: ${ errorMessage }` );
	}
}

export const getThemeDetailsTool: BaseTool = {
	definition,
	execute,
};
