import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { BrowserInspector } from './browser-inspector';
import { findSiteByName, textResult, errorResult } from './tools';

function getRunningsite( name: string ) {
	const site = findSiteByName( name );
	if ( ! site ) {
		return {
			error: errorResult( `Site "${ name }" not found. Use site_list to see available sites.` ),
		};
	}
	if ( ! site.running ) {
		return { error: errorResult( `Site "${ site.name }" is not running. Use site_start first.` ) };
	}
	return { site };
}

const browserNavigateTool = tool(
	'browser_navigate',
	'Navigate the site preview browser to a specific URL. The URL can be a path on the site (e.g. "/wp-admin/", "/sample-page/") or a full URL. The site must be running. Also syncs the visible preview panel.',
	{
		name: z.string().describe( 'The name of the site' ),
		url: z.string().describe( 'URL or path to navigate to (e.g. "/wp-admin/" or full URL)' ),
	},
	async ( args ) => {
		const result = getRunningsite( args.name );
		if ( result.error ) {
			return result.error;
		}
		try {
			const finalUrl = await BrowserInspector.getInstance().navigate( result.site.id, args.url );
			return textResult( `Navigated to ${ finalUrl }` );
		} catch ( error ) {
			return errorResult(
				`Navigation failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);

const browserReloadTool = tool(
	'browser_reload',
	'Reload the current page in the site preview browser. Useful after making changes via WP-CLI or file edits to see the updated result. Also syncs the visible preview panel.',
	{
		name: z.string().describe( 'The name of the site' ),
	},
	async ( args ) => {
		const result = getRunningsite( args.name );
		if ( result.error ) {
			return result.error;
		}
		try {
			await BrowserInspector.getInstance().reload( result.site.id );
			return textResult( 'Page reloaded.' );
		} catch ( error ) {
			return errorResult(
				`Reload failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);

const browserScreenshotTool = tool(
	'browser_screenshot',
	'Take a screenshot of the site as currently displayed in the preview browser. Returns a PNG image. Use this to verify visual changes after editing content or styles.',
	{
		name: z.string().describe( 'The name of the site' ),
	},
	async ( args ) => {
		const result = getRunningsite( args.name );
		if ( result.error ) {
			return result.error;
		}
		try {
			const { data, mimeType } = await BrowserInspector.getInstance().screenshot( result.site.id );
			return {
				content: [ { type: 'image' as const, data, mimeType } ],
			};
		} catch ( error ) {
			return errorResult(
				`Screenshot failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);

const browserReadPageTool = tool(
	'browser_read_page',
	'Read the text content and structure of the current page in the preview browser. Returns the page title, URL, text content, and a structural outline (headings, links, forms, buttons). Useful for verifying content changes.',
	{
		name: z.string().describe( 'The name of the site' ),
	},
	async ( args ) => {
		const result = getRunningsite( args.name );
		if ( result.error ) {
			return result.error;
		}
		try {
			const content = await BrowserInspector.getInstance().getPageContent( result.site.id );
			return textResult( content );
		} catch ( error ) {
			return errorResult(
				`Failed to read page: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);

const browserConsoleTool = tool(
	'browser_console',
	'Read recent console messages (logs, warnings, errors) from the site preview browser. Useful for debugging JavaScript errors or checking plugin output.',
	{
		name: z.string().describe( 'The name of the site' ),
		clear: z
			.boolean()
			.optional()
			.default( false )
			.describe( 'Whether to clear the console buffer after reading' ),
	},
	async ( args ) => {
		const result = getRunningsite( args.name );
		if ( result.error ) {
			return result.error;
		}
		const inspector = BrowserInspector.getInstance();
		const messages = inspector.getConsoleMessages( result.site.id );

		if ( args.clear ) {
			inspector.clearConsoleMessages( result.site.id );
		}

		if ( messages.length === 0 ) {
			return textResult( 'No console messages.' );
		}

		const formatted = messages.map( ( msg ) => {
			const level = `[${ msg.level.toUpperCase() }]`;
			const location = msg.source ? ` (${ msg.source }:${ msg.line })` : '';
			return `${ level }${ location } ${ msg.message }`;
		} );

		return textResult( formatted.join( '\n' ) );
	}
);

export const browserToolDefinitions = [
	browserNavigateTool,
	browserReloadTool,
	browserScreenshotTool,
	browserReadPageTool,
	browserConsoleTool,
];
