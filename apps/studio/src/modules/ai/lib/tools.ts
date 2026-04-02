import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { SiteServer } from 'src/site-server';

function errorResult( message: string ) {
	return {
		content: [ { type: 'text' as const, text: message } ],
		isError: true,
	};
}

function textResult( text: string ) {
	return {
		content: [ { type: 'text' as const, text } ],
	};
}

const siteListTool = tool(
	'site_list',
	'List all local WordPress sites managed by Studio with their running status, paths, and URLs.',
	{},
	async () => {
		const sites = SiteServer.getAllDetails();
		if ( sites.length === 0 ) {
			return textResult( 'No sites found.' );
		}

		const lines = sites.map( ( site ) => {
			const status = site.running ? 'running' : 'stopped';
			const url = site.running ? ` (${ ( site as { url?: string } ).url ?? '' })` : '';
			return `- ${ site.name } [${ status }]${ url } — ${ site.path }`;
		} );
		return textResult( lines.join( '\n' ) );
	}
);

const siteInfoTool = tool(
	'site_info',
	'Get detailed information about a specific WordPress site including path, URL, credentials, PHP version, and running status.',
	{
		name: z.string().describe( 'The name of the site to get info for' ),
	},
	async ( args ) => {
		const sites = SiteServer.getAllDetails();
		const site = sites.find( ( s ) => s.name.toLowerCase() === args.name.toLowerCase() );
		if ( ! site ) {
			return errorResult(
				`Site "${ args.name }" not found. Use site_list to see available sites.`
			);
		}

		const info = [
			`Name: ${ site.name }`,
			`Path: ${ site.path }`,
			`Status: ${ site.running ? 'running' : 'stopped' }`,
			`PHP Version: ${ site.phpVersion }`,
		];

		if ( site.running ) {
			const startedSite = site as { url?: string };
			info.push( `URL: ${ startedSite.url ?? 'unknown' }` );
		}

		if ( site.adminUsername ) {
			info.push( `Admin Username: ${ site.adminUsername }` );
		}
		if ( site.adminPassword ) {
			info.push( `Admin Password: ${ site.adminPassword }` );
		}

		return textResult( info.join( '\n' ) );
	}
);

const siteStartTool = tool(
	'site_start',
	'Start a stopped WordPress site so it can be accessed in a browser and WP-CLI commands can be run.',
	{
		name: z.string().describe( 'The name of the site to start' ),
	},
	async ( args ) => {
		const sites = SiteServer.getAllDetails();
		const site = sites.find( ( s ) => s.name.toLowerCase() === args.name.toLowerCase() );
		if ( ! site ) {
			return errorResult( `Site "${ args.name }" not found.` );
		}

		if ( site.running ) {
			return textResult( `Site "${ site.name }" is already running.` );
		}

		const server = SiteServer.get( site.id );
		if ( ! server ) {
			return errorResult( `Could not find server for site "${ site.name }".` );
		}

		try {
			await server.start();
			const updated = SiteServer.get( site.id );
			const url = updated?.details.running ? ( updated.details as { url?: string } ).url ?? '' : '';
			return textResult( `Site "${ site.name }" started.${ url ? ` URL: ${ url }` : '' }` );
		} catch ( error ) {
			return errorResult(
				`Failed to start site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);

const siteStopTool = tool(
	'site_stop',
	'Stop a running WordPress site.',
	{
		name: z.string().describe( 'The name of the site to stop' ),
	},
	async ( args ) => {
		const sites = SiteServer.getAllDetails();
		const site = sites.find( ( s ) => s.name.toLowerCase() === args.name.toLowerCase() );
		if ( ! site ) {
			return errorResult( `Site "${ args.name }" not found.` );
		}

		if ( ! site.running ) {
			return textResult( `Site "${ site.name }" is already stopped.` );
		}

		const server = SiteServer.get( site.id );
		if ( ! server ) {
			return errorResult( `Could not find server for site "${ site.name }".` );
		}

		try {
			await server.stop();
			return textResult( `Site "${ site.name }" stopped.` );
		} catch ( error ) {
			return errorResult(
				`Failed to stop site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);

const wpCliTool = tool(
	'wp_cli',
	'Run a WP-CLI command on a running WordPress site. The site must be running. Example commands: "plugin list", "post create --post_title=Hello --post_type=page", "option get blogname".',
	{
		name: z.string().describe( 'The name of the site to run the command on' ),
		command: z
			.string()
			.describe(
				'The WP-CLI command to run (without the "wp" prefix), e.g. "plugin list --format=json"'
			),
	},
	async ( args ) => {
		const sites = SiteServer.getAllDetails();
		const site = sites.find( ( s ) => s.name.toLowerCase() === args.name.toLowerCase() );
		if ( ! site ) {
			return errorResult( `Site "${ args.name }" not found.` );
		}

		if ( ! site.running ) {
			return errorResult( `Site "${ site.name }" is not running. Use site_start first.` );
		}

		const server = SiteServer.get( site.id );
		if ( ! server ) {
			return errorResult( `Could not find server for site "${ site.name }".` );
		}

		try {
			const result = await server.executeWpCliCommand( args.command );
			if ( result.stderr ) {
				return errorResult( result.stderr );
			}
			return textResult( result.stdout || 'Command completed successfully.' );
		} catch ( error ) {
			return errorResult(
				`WP-CLI error: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);

const studioToolDefinitions = [
	siteListTool,
	siteInfoTool,
	siteStartTool,
	siteStopTool,
	wpCliTool,
];

/**
 * Create the Studio MCP server with desktop-native tool implementations.
 * These tools use SiteServer directly instead of the CLI daemon.
 */
export function createDesktopStudioTools() {
	return createSdkMcpServer( {
		name: 'studio',
		version: '1.0.0',
		tools: studioToolDefinitions,
	} );
}
