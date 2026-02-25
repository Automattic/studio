import { readFile } from 'fs/promises';
import path from 'path';
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { z } from 'zod';
import { validateBlocks } from 'cli/ai/block-validator';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { runCommand as runListSitesCommand } from 'cli/commands/site/list';
import { runCommand as runStartSiteCommand } from 'cli/commands/site/start';
import { runCommand as runStatusCommand } from 'cli/commands/site/status';
import { runCommand as runStopSiteCommand, Mode as StopMode } from 'cli/commands/site/stop';
import { getSiteByFolder, getSiteUrl, readAppdata, type SiteData } from 'cli/lib/appdata';
import { connect, disconnect, setKeepAlive } from 'cli/lib/pm2-manager';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { setProgressCallback } from 'cli/logger';

export function setToolProgressHandler( handler: ( message: string ) => void ): void {
	setProgressCallback( handler );
}

export function enablePm2KeepAlive(): void {
	setKeepAlive( true );
}

const SITES_ROOT = path.join( process.env.HOME || '~', 'Studio' );

/**
 * Splits a command string into arguments, respecting quoted strings.
 * Handles both single and double quotes, e.g.:
 *   post create --post_title="Ember & Oak" --post_type=page
 *   → ['post', 'create', '--post_title=Ember & Oak', '--post_type=page']
 */
function splitCommandArgs( command: string ): string[] {
	const args: string[] = [];
	let current = '';
	let inQuote: string | null = null;

	for ( let i = 0; i < command.length; i++ ) {
		const char = command[ i ];

		if ( inQuote ) {
			if ( char === inQuote ) {
				inQuote = null;
			} else {
				current += char;
			}
		} else if ( char === '"' || char === "'" ) {
			inQuote = char;
		} else if ( /\s/.test( char ) ) {
			if ( current ) {
				args.push( current );
				current = '';
			}
		} else {
			current += char;
		}
	}

	if ( current ) {
		args.push( current );
	}

	return args;
}

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

/**
 * Captures console.log output during a function call.
 * Used for commands (list, status) that print JSON to console instead of returning data.
 */
async function captureConsoleOutput( fn: () => Promise< void > ): Promise< string > {
	let captured = '';
	const origLog = console.log;
	const origTable = console.table;
	console.log = ( ...args: unknown[] ) => {
		captured += args.map( String ).join( ' ' ) + '\n';
	};
	console.table = ( ...args: unknown[] ) => {
		captured += args.map( String ).join( ' ' ) + '\n';
	};
	try {
		await fn();
	} finally {
		console.log = origLog;
		console.table = origTable;
	}
	return captured.trim();
}

const createSiteTool = tool(
	'site_create',
	'Creates a new WordPress site with the latest WordPress version. Automatically sets up the site directory, installs WordPress, registers the site, and starts the server. Returns the site URL and credentials.',
	z.object( {
		name: z.string().describe( 'The name for the new site (e.g., "My Coffee Shop")' ),
	} ),
	async ( args ) => {
		try {
			const slug = args.name
				.toLowerCase()
				.replace( /[^a-z0-9]+/g, '-' )
				.replace( /^-|-$/g, '' );
			const sitePath = path.join( SITES_ROOT, slug );

			await runCreateSiteCommand( sitePath, {
				name: args.name,
				wpVersion: 'latest',
				phpVersion: DEFAULT_PHP_VERSION,
				enableHttps: false,
				noStart: false,
				skipBrowser: true,
				skipLogDetails: true,
			} );

			// Read back the created site to return its details
			const site = await resolveSite( args.name );
			const url = getSiteUrl( site );
			return textResult(
				JSON.stringify(
					{
						name: site.name,
						path: site.path,
						url,
						adminUrl: `${ url }/wp-admin`,
						username: 'admin',
						password: site.adminPassword,
						phpVersion: site.phpVersion,
					},
					null,
					2
				)
			);
		} catch ( error ) {
			return errorResult(
				`Failed to create site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);

const listSitesTool = tool(
	'site_list',
	'Lists all WordPress sites managed by Studio with their name, path, URL, and running status.',
	z.object( {} ),
	async () => {
		try {
			const output = await captureConsoleOutput( () => runListSitesCommand( 'json' ) );
			return textResult( output || 'No sites found.' );
		} catch ( error ) {
			return errorResult(
				`Failed to list sites: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);

const getSiteInfoTool = tool(
	'site_info',
	'Gets detailed information about a specific WordPress site by name or path, including its running status, URL, PHP version, and admin credentials.',
	z.object( {
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
	} ),
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			const output = await captureConsoleOutput( () => runStatusCommand( site.path, 'json' ) );
			return textResult( output || 'No site info available.' );
		} catch ( error ) {
			return errorResult(
				`Failed to get site info: ${ error instanceof Error ? error.message : String( error ) }`
			);
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
			await runStartSiteCommand( site.path, true, true );
			return textResult( `Site "${ site.name }" started at ${ getSiteUrl( site ) }` );
		} catch ( error ) {
			return errorResult(
				`Failed to start site: ${ error instanceof Error ? error.message : String( error ) }`
			);
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
			await runStopSiteCommand( StopMode.STOP_SINGLE_SITE, site.path, false );
			return textResult( `Site "${ site.name }" stopped.` );
		} catch ( error ) {
			return errorResult(
				`Failed to stop site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);

// Note: wp.ts runCommand calls process.exit(), so we use the lower-level sendWpCliCommand directly.
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
					return errorResult(
						`Site "${ site.name }" is not running. Start it first using site_start.`
					);
				}

				const wpCliArgs = splitCommandArgs( args.command );
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
					content: [
						{ type: 'text' as const, text: output || 'Command completed with no output.' },
					],
					isError: result.exitCode !== 0,
				};
			} finally {
				await disconnect();
			}
		} catch ( error ) {
			return errorResult(
				`Failed to run WP-CLI command: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	}
);

const validateBlocksTool = tool(
	'validate_blocks',
	'Validates WordPress block content by parsing it and checking each block against its registered save() function. ' +
		'Returns per-block validation results showing which blocks are valid and which have issues, ' +
		'along with the expected HTML for invalid blocks so you can fix them.',
	z.object( {
		filePath: z
			.string()
			.optional()
			.describe( 'Path to a file containing WordPress block content to validate' ),
		content: z
			.string()
			.optional()
			.describe( 'Raw WordPress block content (HTML with block comments) to validate' ),
	} ),
	async ( args ) => {
		try {
			let blockContent: string;

			if ( args.filePath ) {
				blockContent = await readFile( args.filePath, 'utf-8' );
			} else if ( args.content ) {
				blockContent = args.content;
			} else {
				return errorResult( 'Either content or filePath must be provided.' );
			}

			const report = validateBlocks( blockContent );

			if ( report.error ) {
				return errorResult( `Block validator initialization failed: ${ report.error }` );
			}

			const lines: string[] = [];
			lines.push( `Validation: ${ report.validBlocks }/${ report.totalBlocks } blocks valid` );

			if ( report.invalidBlocks > 0 ) {
				lines.push( '' );
				lines.push( 'Invalid blocks:' );
				for ( const result of report.results ) {
					if ( ! result.isValid ) {
						lines.push( `  - ${ result.blockName }` );
						for ( const issue of result.issues ) {
							lines.push( `    ${ issue }` );
						}
						if ( result.expectedContent !== undefined ) {
							lines.push( `    Expected: ${ result.expectedContent }` );
							lines.push( `    Actual:   ${ result.originalContent }` );
						}
					}
				}
			}

			return textResult( lines.join( '\n' ) );
		} catch ( error ) {
			return errorResult(
				`Block validation failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);

export function createStudioTools() {
	return createSdkMcpServer( {
		name: 'studio',
		version: '1.0.0',
		tools: [
			createSiteTool,
			listSitesTool,
			getSiteInfoTool,
			startSiteTool,
			stopSiteTool,
			runWpCliTool,
			validateBlocksTool,
		],
	} );
}
