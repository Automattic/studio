import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { readAppdata, getSiteByFolder, getSiteUrl, type SiteData } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { isSiteRunning } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
	sendWpCliCommand,
} from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';

async function findSiteByName( name: string ): Promise< SiteData | undefined > {
	const appdata = await readAppdata();
	return appdata.sites.find( ( site ) => site.name.toLowerCase() === name.toLowerCase() );
}

async function resolveSite( nameOrPath: string ): Promise< SiteData > {
	const siteByName = await findSiteByName( nameOrPath );
	if ( siteByName ) {
		return siteByName;
	}
	return getSiteByFolder( nameOrPath );
}

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

const listSitesTool = tool(
	'site_list',
	'Lists all WordPress sites managed by Studio with their name, path, URL, PHP version, and running status.',
	z.object( {} ),
	async () => {
		try {
			const appdata = await readAppdata();
			if ( appdata.sites.length === 0 ) {
				return textResult( 'No sites found.' );
			}

			try {
				await connect();
				const sites = [];
				for ( const site of appdata.sites ) {
					const running = await isSiteRunning( site );
					sites.push( {
						name: site.name,
						path: site.path,
						url: getSiteUrl( site ),
						phpVersion: site.phpVersion,
						running,
					} );
				}
				return textResult( JSON.stringify( sites, null, 2 ) );
			} finally {
				await disconnect();
			}
		} catch ( error ) {
			return errorResult( `Failed to list sites: ${ error instanceof Error ? error.message : String( error ) }` );
		}
	}
);

const getSiteInfoTool = tool(
	'site_info',
	'Gets detailed information about a specific WordPress site by name or path, including its running status, URL, PHP version, and custom domain.',
	z.object( {
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
	} ),
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			let running = false;

			try {
				await connect();
				running = await isSiteRunning( site );
			} finally {
				await disconnect();
			}

			const info = {
				name: site.name,
				path: site.path,
				url: getSiteUrl( site ),
				phpVersion: site.phpVersion,
				running,
				customDomain: site.customDomain || null,
				enableHttps: site.enableHttps || false,
			};

			return textResult( JSON.stringify( info, null, 2 ) );
		} catch ( error ) {
			return errorResult( `Failed to get site info: ${ error instanceof Error ? error.message : String( error ) }` );
		}
	}
);

const startSiteTool = tool(
	'site_start',
	'Starts a WordPress site by name or path. The site must already exist in Studio.',
	z.object( {
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
	} ),
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );

			try {
				await connect();

				const runningProcess = await isServerRunning( site.id );
				if ( runningProcess ) {
					return textResult( `Site "${ site.name }" is already running at ${ getSiteUrl( site ) }` );
				}

				await keepSqliteIntegrationUpdated( site.path );

				const logger = new Logger< string >();
				await startWordPressServer( site, logger );

				return textResult( `Site "${ site.name }" started at ${ getSiteUrl( site ) }` );
			} finally {
				await disconnect();
			}
		} catch ( error ) {
			return errorResult( `Failed to start site: ${ error instanceof Error ? error.message : String( error ) }` );
		}
	}
);

const stopSiteTool = tool(
	'site_stop',
	'Stops a running WordPress site by name or path.',
	z.object( {
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
	} ),
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );

			try {
				await connect();

				const runningProcess = await isServerRunning( site.id );
				if ( ! runningProcess ) {
					return textResult( `Site "${ site.name }" is not running.` );
				}

				await stopWordPressServer( site.id );
				return textResult( `Site "${ site.name }" stopped.` );
			} finally {
				await disconnect();
			}
		} catch ( error ) {
			return errorResult( `Failed to stop site: ${ error instanceof Error ? error.message : String( error ) }` );
		}
	}
);

const runWpCliTool = tool(
	'wp_cli',
	'Runs a WP-CLI command on a specific WordPress site. The site must be running. Examples: "plugin install woocommerce --activate", "option get blogname", "user list".',
	z.object( {
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
		command: z
			.string()
			.describe(
				'The WP-CLI command to run (without the "wp" prefix). Example: "plugin list --status=active"'
			),
	} ),
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );

			try {
				await connect();

				const runningProcess = await isServerRunning( site.id );
				if ( ! runningProcess ) {
					return errorResult( `Site "${ site.name }" is not running. Start it first using site_start.` );
				}

				const wpCliArgs = args.command.split( /\s+/ );
				const result = await sendWpCliCommand( site.id, wpCliArgs );

				let output = '';
				if ( result.stdout ) {
					output += result.stdout;
				}
				if ( result.stderr ) {
					output += ( output ? '\n' : '' ) + `stderr: ${ result.stderr }`;
				}
				if ( result.exitCode !== 0 ) {
					output += `\nExit code: ${ result.exitCode }`;
				}

				return {
					content: [ { type: 'text' as const, text: output || 'Command completed with no output.' } ],
					isError: result.exitCode !== 0,
				};
			} finally {
				await disconnect();
			}
		} catch ( error ) {
			return errorResult( `Failed to run WP-CLI command: ${ error instanceof Error ? error.message : String( error ) }` );
		}
	}
);

export function createStudioTools() {
	return createSdkMcpServer( {
		name: 'studio',
		version: '1.0.0',
		tools: [ listSitesTool, getSiteInfoTool, startSiteTool, stopSiteTool, runWpCliTool ],
	} );
}
