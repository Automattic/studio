import { readFile } from 'fs/promises';
import path from 'path';
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { z } from 'zod/v4';
import { validateBlocks, type ValidationReport } from 'cli/ai/block-validator';
import { getSharedBrowser } from 'cli/ai/browser-utils';
import { runCommand as runCreatePreviewCommand } from 'cli/commands/preview/create';
import {
	Mode as PreviewDeleteMode,
	runCommand as runDeletePreviewCommand,
} from 'cli/commands/preview/delete';
import { runCommand as runListPreviewCommand } from 'cli/commands/preview/list';
import { runCommand as runUpdatePreviewCommand } from 'cli/commands/preview/update';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { runCommand as runDeleteSiteCommand } from 'cli/commands/site/delete';
import { runCommand as runListSitesCommand } from 'cli/commands/site/list';
import { runCommand as runStartSiteCommand } from 'cli/commands/site/start';
import { runCommand as runStatusCommand } from 'cli/commands/site/status';
import { runCommand as runStopSiteCommand, Mode as StopMode } from 'cli/commands/site/stop';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import { getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { getUnsupportedWpCliPostContentMessage } from 'cli/lib/rewrite-wp-cli-post-content';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { normalizeHostname } from 'cli/lib/utils';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { getProgressCallback, setProgressCallback, emitProgress } from 'cli/logger';

/**
 * Splits a command string into arguments, respecting quoted strings.
 * Handles both single and double quotes, e.g.:
 *   post create --post_title="Ember & Oak" --post_type=page
 *   → ['post', 'create', '--post_title=Ember & Oak', '--post_type=page']
 */
function splitBasicCommandArgs( command: string ): string[] {
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
		} else if (
			( char === '"' || char === "'" ) &&
			( current === '' || current.endsWith( '=' ) )
		) {
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

function stripMatchingOuterQuotes( value: string ): string {
	if ( value.length < 2 ) {
		return value;
	}

	const firstChar = value[ 0 ];
	const lastChar = value[ value.length - 1 ];
	if ( ( firstChar === '"' || firstChar === "'" ) && firstChar === lastChar ) {
		return value.slice( 1, -1 );
	}

	return value;
}

function splitCommandArgs( command: string ): string[] {
	const postContentMarker = '--post_content=';
	const postContentIndex = command.indexOf( postContentMarker );

	// Large block content is commonly emitted without shell quoting and should
	// be treated as a single literal argument that consumes the rest of the command.
	if ( postContentIndex !== -1 ) {
		const prefix = command.slice( 0, postContentIndex ).trim();
		const postContent = stripMatchingOuterQuotes(
			command.slice( postContentIndex + postContentMarker.length ).trim()
		);

		return [ ...splitBasicCommandArgs( prefix ), `${ postContentMarker }${ postContent }` ];
	}

	return splitBasicCommandArgs( command );
}

async function findSiteByName( name: string ): Promise< SiteData | undefined > {
	const config = await readCliConfig();
	return config.sites.find( ( site ) => site.name.toLowerCase() === name.toLowerCase() );
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

function formatInvalidBlocks( report: ValidationReport ): string[] {
	const lines: string[] = [];
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
	return lines;
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

async function captureCommandOutput( fn: () => Promise< void > ): Promise< {
	consoleOutput: string;
	progressOutput: string;
	exitCode: number | undefined;
} > {
	let consoleOutput = '';
	const progressMessages: string[] = [];
	let thrownError: unknown;
	const originalConsoleLog = console.log;
	const originalConsoleTable = console.table;
	const previousCallback = getProgressCallback();
	const previousExitCode = process.exitCode;

	console.log = ( ...args: unknown[] ) => {
		consoleOutput += args.map( String ).join( ' ' ) + '\n';
	};
	console.table = ( ...args: unknown[] ) => {
		consoleOutput += args.map( String ).join( ' ' ) + '\n';
	};
	process.exitCode = undefined;
	setProgressCallback( ( message ) => {
		progressMessages.push( message );
	} );

	try {
		await fn();
	} catch ( error ) {
		thrownError = error;
	} finally {
		console.log = originalConsoleLog;
		console.table = originalConsoleTable;
		setProgressCallback( previousCallback );
	}

	const exitCode = process.exitCode;
	process.exitCode = previousExitCode;

	if ( thrownError ) {
		throw thrownError;
	}

	return {
		consoleOutput: consoleOutput.trim(),
		progressOutput: progressMessages.join( '\n' ),
		exitCode,
	};
}

async function runPreviewCommand(
	fn: () => Promise< void >,
	fallbackMessage: string,
	errorPrefix: string
) {
	try {
		const result = await captureCommandOutput( fn );
		const output = result.consoleOutput || result.progressOutput || fallbackMessage;

		if ( result.exitCode ) {
			return errorResult( output );
		}

		return textResult( output );
	} catch ( error ) {
		return errorResult(
			`${ errorPrefix }: ${ error instanceof Error ? error.message : String( error ) }`
		);
	}
}

const createSiteTool = tool(
	'site_create',
	'Creates a new WordPress site with the latest WordPress version. Automatically sets up the site directory, installs WordPress, registers the site, and starts the server. Returns the site URL and credentials.',
	{
		name: z.string().describe( 'The name for the new site (e.g., "My Coffee Shop")' ),
	},
	async ( args ) => {
		try {
			const slug = args.name
				.toLowerCase()
				.replace( /[^a-z0-9]+/g, '-' )
				.replace( /^-|-$/g, '' );
			if ( ! slug ) {
				return errorResult(
					'Site name must contain at least one ASCII letter or digit (a-z, 0-9).'
				);
			}
			const sitePath = path.join( STUDIO_SITES_ROOT, slug );

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
	{},
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
	{
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
	},
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
	{
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
	},
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
	{
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
	},
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

const deleteSiteTool = tool(
	'site_delete',
	'Deletes a WordPress site by name or path. Removes the site from Studio and optionally moves site files to trash.',
	{
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
		deleteFiles: z
			.boolean()
			.optional()
			.describe( 'Also move site files to trash. Defaults to false.' ),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			await runDeleteSiteCommand( site.path, args.deleteFiles ?? false );
			return textResult( `Site "${ site.name }" deleted.` );
		} catch ( error ) {
			return errorResult(
				`Failed to delete site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);

const createPreviewTool = tool(
	'preview_create',
	'Creates a WordPress.com preview site from a local Studio site. Requires WordPress.com authentication. This can take a few minutes, so tell the user to wait after starting it.',
	{
		nameOrPath: z.string().describe( 'The local site name or file system path to preview' ),
	},
	async ( args ) => {
		return runPreviewCommand(
			async () => {
				const site = await resolveSite( args.nameOrPath );
				await runCreatePreviewCommand( site.path );
			},
			`Preview site created for "${ args.nameOrPath }".`,
			'Failed to create preview site'
		);
	}
);

const listPreviewsTool = tool(
	'preview_list',
	'Lists WordPress.com preview sites associated with a local Studio site. Requires WordPress.com authentication.',
	{
		nameOrPath: z.string().describe( 'The local site name or file system path' ),
	},
	async ( args ) => {
		return runPreviewCommand(
			async () => {
				const site = await resolveSite( args.nameOrPath );
				await runListPreviewCommand( site.path, 'json' );
			},
			`No preview sites found for "${ args.nameOrPath }".`,
			'Failed to list preview sites'
		);
	}
);

const updatePreviewTool = tool(
	'preview_update',
	'Updates an existing WordPress.com preview site from a local Studio site. Requires WordPress.com authentication. This can take a few minutes, so tell the user to wait after starting it.',
	{
		nameOrPath: z.string().describe( 'The local site name or file system path' ),
		host: z
			.string()
			.describe( 'The preview hostname or URL to update, for example "site.wordpress.com"' ),
		overwrite: z
			.boolean()
			.optional()
			.describe(
				'Allow updating the preview from a different local directory. Defaults to false.'
			),
	},
	async ( args ) => {
		const normalizedHost = normalizeHostname( args.host );
		return runPreviewCommand(
			async () => {
				const site = await resolveSite( args.nameOrPath );
				await runUpdatePreviewCommand( site.path, normalizedHost, args.overwrite ?? false );
			},
			`Preview site "${ normalizedHost }" updated from "${ args.nameOrPath }".`,
			'Failed to update preview site'
		);
	}
);

const deletePreviewTool = tool(
	'preview_delete',
	'Deletes a WordPress.com preview site by hostname or URL. Requires WordPress.com authentication.',
	{
		host: z
			.string()
			.describe( 'The preview hostname or URL to delete, for example "site.wordpress.com"' ),
	},
	async ( args ) => {
		const normalizedHost = normalizeHostname( args.host );
		return runPreviewCommand(
			() => runDeletePreviewCommand( PreviewDeleteMode.DELETE_SINGLE_SNAPSHOT, normalizedHost ),
			`Preview site "${ normalizedHost }" deleted.`,
			'Failed to delete preview site'
		);
	}
);

// Note: wp.ts runCommand calls process.exit(), so we use the lower-level sendWpCliCommand directly.
const runWpCliTool = tool(
	'wp_cli',
	'Runs a WP-CLI command on a specific WordPress site. The site must be running. ' +
		'Examples: "plugin install woocommerce --activate", "option get blogname", "user list".',
	{
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
		command: z
			.string()
			.describe(
				'The WP-CLI command to run (without the "wp" prefix). Example: "plugin list --status=active"'
			),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );

			try {
				await connectToDaemon();

				const runningProcess = await isServerRunning( site.id );
				if ( ! runningProcess ) {
					return errorResult(
						`Site "${ site.name }" is not running. Start it first using site_start.`
					);
				}

				const wpCliArgs = splitCommandArgs( args.command );
				const unsupportedPostContentMessage = getUnsupportedWpCliPostContentMessage( wpCliArgs );
				if ( unsupportedPostContentMessage ) {
					return errorResult( unsupportedPostContentMessage );
				}

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
				await disconnectFromDaemon();
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
	"Validates WordPress block content by running each block through its save() function in the site's block editor (real browser). " +
		'The site must be running. Returns per-block validation results with expected HTML for invalid blocks.',
	{
		nameOrPath: z
			.string()
			.describe( 'The site name or file system path — the site must be running' ),
		filePath: z
			.string()
			.optional()
			.describe( 'Path to a file containing WordPress block content to validate' ),
		content: z
			.string()
			.optional()
			.describe( 'Raw WordPress block content (HTML with block comments) to validate' ),
	},
	async ( args ) => {
		try {
			let blockContent: string;
			let fileName = 'inline content';

			if ( args.filePath ) {
				blockContent = await readFile( args.filePath, 'utf-8' );
				fileName = args.filePath.split( '/' ).slice( -2 ).join( '/' );
			} else if ( args.content ) {
				blockContent = args.content;
			} else {
				return errorResult( 'Either content or filePath must be provided.' );
			}

			emitProgress( `Validating blocks in ${ fileName }…` );

			const site = await resolveSite( args.nameOrPath );
			const siteUrl = getSiteUrl( site );
			const report = await validateBlocks( blockContent, siteUrl );

			if ( report.error ) {
				emitProgress( `Validation failed for ${ fileName }: ${ report.error.slice( 0, 80 ) }` );
				return errorResult( `Block validation failed: ${ report.error }` );
			}

			// Update progress with result summary
			if ( report.invalidBlocks > 0 ) {
				const invalidNames = report.results
					.filter( ( r ) => ! r.isValid )
					.map( ( r ) => r.blockName )
					.join( ', ' );
				emitProgress( `${ fileName }: ${ report.invalidBlocks } invalid (${ invalidNames })` );
			} else {
				emitProgress( `${ fileName }: all ${ report.totalBlocks } blocks valid` );
			}

			const lines = [ `Validation: ${ report.validBlocks }/${ report.totalBlocks } blocks valid` ];

			if ( report.invalidBlocks > 0 ) {
				lines.push( '', 'Invalid blocks:', ...formatInvalidBlocks( report ) );
			}

			return textResult( lines.join( '\n' ) );
		} catch ( error ) {
			return errorResult(
				`Block validation failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);

// --- Browser control tools (IPC to desktop app) ---

/**
 * Send a message to the desktop app via Node IPC.
 * Only available when spawned as a child process by the desktop (fork with IPC channel).
 */
function sendToDesktop( message: Record< string, unknown > ): boolean {
	if ( process.send ) {
		process.send( message );
		return true;
	}
	return false;
}

const browserNavigateTool = tool(
	'browser_navigate',
	'Navigates the in-app browser preview to a URL, path, or local file. ' +
		'Use this after making changes to reload the preview, or to show HTML design previews. ' +
		'Supports site paths (e.g. "/wp-admin/"), full URLs, and local file paths (e.g. "/Users/.../preview.html"). ' +
		'Only available when running inside the Studio desktop app.',
	{
		url: z
			.string()
			.describe(
				'The URL, path, or local file path to navigate to (e.g. "/wp-admin/", "http://localhost:8881/", or "/Users/.../preview.html")'
			),
	},
	async ( args ) => {
		if ( ! sendToDesktop( { type: 'ai:browser-navigate', url: args.url } ) ) {
			return errorResult(
				'Browser control is only available when running inside the Studio desktop app.'
			);
		}
		return textResult( `Navigated browser to ${ args.url }` );
	}
);

const browserReloadTool = tool(
	'browser_reload',
	'Reloads the current page in the in-app browser preview. ' +
		'Use this after making changes to refresh the preview. ' +
		'Only available when running inside the Studio desktop app.',
	{},
	async () => {
		if ( ! sendToDesktop( { type: 'ai:browser-reload' } ) ) {
			return errorResult(
				'Browser control is only available when running inside the Studio desktop app.'
			);
		}
		return textResult( 'Browser preview reloaded.' );
	}
);

// --- Screenshot tool ---

const VIEWPORTS = {
	desktop: { width: 1040, height: 1248 },
	mobile: { width: 390, height: 844 },
} as const;

const takeScreenshotTool = tool(
	'take_screenshot',
	'Takes a full-page screenshot of a URL. Returns the screenshot as an image that you can analyze visually. ' +
		'Supports desktop and mobile viewports. Use this to verify the site looks correct after building it.',
	{
		url: z.string().describe( 'The URL to screenshot' ),
		viewport: z
			.enum( [ 'desktop', 'mobile' ] )
			.optional()
			.describe(
				'Viewport size: "desktop" (1040x1248) or "mobile" (390x844). Defaults to desktop.'
			),
	},
	async ( args ) => {
		try {
			const viewportType = args.viewport ?? 'desktop';
			const viewport = VIEWPORTS[ viewportType ];

			emitProgress( `Taking ${ viewportType } screenshot of ${ args.url }…` );

			const browser = await getSharedBrowser();
			const page = await browser.newPage( { viewport } );

			try {
				// Reduce motion to avoid capturing mid-animation states
				await page.emulateMedia( { reducedMotion: 'reduce' } );

				await page.goto( args.url, { waitUntil: 'networkidle', timeout: 15000 } );

				// Wait for all images to finish loading
				await page.evaluate( () =>
					Promise.all(
						Array.from( document.images )
							.filter( ( img ) => ! img.complete )
							.map(
								( img ) =>
									new Promise< void >( ( resolve ) => {
										img.addEventListener( 'load', () => resolve() );
										img.addEventListener( 'error', () => resolve() );
									} )
							)
					)
				);

				// Hide WordPress admin bar and scrollbars for cleaner screenshots
				await page.addStyleTag( {
					content: `
						#wpadminbar { display: none !important; }
						html { margin-top: 0 !important; }
						::-webkit-scrollbar { display: none !important; }
						html, body { scrollbar-width: none !important; }
					`,
				} );

				const buffer = await page.screenshot( { fullPage: true, type: 'png' } );
				const base64 = buffer.toString( 'base64' );

				emitProgress( `Screenshot captured (${ viewportType })` );

				return {
					content: [
						{
							type: 'image' as const,
							data: base64,
							mimeType: 'image/png',
						},
					],
				};
			} finally {
				await page.close();
			}
		} catch ( error ) {
			return errorResult(
				`Screenshot failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);

export const studioToolDefinitions = [
	createSiteTool,
	listSitesTool,
	getSiteInfoTool,
	startSiteTool,
	stopSiteTool,
	deleteSiteTool,
	createPreviewTool,
	listPreviewsTool,
	updatePreviewTool,
	deletePreviewTool,
	runWpCliTool,
	validateBlocksTool,
	takeScreenshotTool,
	browserNavigateTool,
	browserReloadTool,
];

export function createStudioTools() {
	return createSdkMcpServer( {
		name: 'studio',
		version: '1.0.0',
		tools: studioToolDefinitions,
	} );
}
