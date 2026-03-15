import { readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { z } from 'zod/v4';
import { validateBlocks, type ValidationReport } from 'cli/ai/block-validator';
import { getSharedBrowser } from 'cli/ai/browser-utils';
import { runCommand as runCreatePreviewCommand } from 'cli/commands/preview/create';
import { runCommand as runDeletePreviewCommand } from 'cli/commands/preview/delete';
import { runCommand as runListPreviewCommand } from 'cli/commands/preview/list';
import { runCommand as runUpdatePreviewCommand } from 'cli/commands/preview/update';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { runCommand as runDeleteSiteCommand } from 'cli/commands/site/delete';
import { runCommand as runListSitesCommand } from 'cli/commands/site/list';
import { runCommand as runStartSiteCommand } from 'cli/commands/site/start';
import { runCommand as runStatusCommand } from 'cli/commands/site/status';
import { runCommand as runStopSiteCommand, Mode as StopMode } from 'cli/commands/site/stop';
import { getSiteByFolder, getSiteUrl, readAppdata, type SiteData } from 'cli/lib/appdata';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { normalizeHostname } from 'cli/lib/utils';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { getProgressCallback, setProgressCallback, emitProgress } from 'cli/logger';

const SITES_ROOT = path.join( os.homedir(), 'Studio' );

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
			() => runDeletePreviewCommand( normalizedHost ),
			`Preview site "${ normalizedHost }" deleted.`,
			'Failed to delete preview site'
		);
	}
);

const BLOCK_COMMENT_PATTERN = /<!-- wp:/;

function extractPostContent( command: string ): string | undefined {
	const args = splitCommandArgs( command );
	for ( const arg of args ) {
		if ( arg.startsWith( '--post_content=' ) ) {
			return arg.slice( '--post_content='.length );
		}
	}
	return undefined;
}

function isPostContentCommand( command: string ): boolean {
	const trimmed = command.trimStart();
	return (
		( trimmed.startsWith( 'post create' ) || trimmed.startsWith( 'post update' ) ) &&
		trimmed.includes( '--post_content=' )
	);
}

// Note: wp.ts runCommand calls process.exit(), so we use the lower-level sendWpCliCommand directly.
const runWpCliTool = tool(
	'wp_cli',
	'Runs a WP-CLI command on a specific WordPress site. The site must be running. ' +
		'Post content (in post create/update with --post_content) is automatically validated for block correctness before execution. ' +
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

			// Validate block content in post create/update commands before executing
			if ( isPostContentCommand( args.command ) ) {
				const postContent = extractPostContent( args.command );
				if ( postContent && BLOCK_COMMENT_PATTERN.test( postContent ) ) {
					emitProgress( 'Validating post content blocks…' );
					const siteUrl = getSiteUrl( site );
					const report = await validateBlocks( postContent, siteUrl );
					if ( report.invalidBlocks > 0 ) {
						const lines = [
							`Block validation failed: ${ report.invalidBlocks }/${ report.totalBlocks } blocks invalid. Fix the content before creating/updating the post.`,
							'',
							...formatInvalidBlocks( report ),
						];
						return errorResult( lines.join( '\n' ) );
					}
					emitProgress( `Post content: all ${ report.totalBlocks } blocks valid` );
				}
			}

			try {
				await connectToDaemon();

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

// --- HTML to blocks tool ---

const BLOCK_CONVERSION_GUIDELINES = `## Block conversion guidelines

Convert each HTML section into the closest core block. Apply styling in this priority order:

1. **theme.json** — global defaults (blockGap, contentSize, wideSize, font families, color palette, spacing scale). Set once, applies everywhere.
2. **Block attributes** — per-block overrides for spacing, colors, typography, borders. These render in the editor too.
3. **className + CSS** — for effects and sophisticated treatments that block attrs can't express: blurs, perspective, transforms, animations, gradients, pseudo-elements, hover states.

### 1. theme.json globals (set these first)

Block gap (vertical spacing between all blocks):
{"settings":{"spacing":{"blockGap":true}},"styles":{"spacing":{"blockGap":"1.5rem"}}}

Content width:
{"settings":{"layout":{"contentSize":"800px","wideSize":"1200px"}}}

Font families (register once, reference by slug in block attrs):
{"settings":{"typography":{"fontFamilies":[{"fontFamily":"Playfair Display, serif","slug":"playfair","name":"Playfair"}]}}}

Color palette:
{"settings":{"color":{"palette":[{"color":"#1a1a2e","slug":"primary","name":"Primary"}]}}}

### 2. Block attributes (per-block overrides)

Spacing (padding/margin):
<!-- wp:group {"style":{"spacing":{"padding":{"top":"2rem","right":"2rem","bottom":"2rem","left":"2rem"},"margin":{"top":"0","bottom":"0"}}}} -->

Colors (background/text — use palette slugs when available):
<!-- wp:group {"backgroundColor":"primary","textColor":"white"} -->
<!-- wp:group {"style":{"color":{"background":"#1a1a2e","text":"#ffffff"}}} -->

Typography (size/family/weight):
<!-- wp:paragraph {"style":{"typography":{"fontSize":"1.25rem","fontWeight":"700"}},"fontFamily":"playfair"} -->

Border (radius/width/color):
<!-- wp:group {"style":{"border":{"radius":"8px","width":"1px","color":"#e0e0e0"}}} -->

### 3. className + CSS (effects and advanced styling)

For anything block attrs can't handle — set className on the block, write CSS in style.css:
<!-- wp:group {"className":"hero-section"} -->

Target in style.css:
.hero-section { backdrop-filter: blur(10px); transform: perspective(1000px) rotateY(2deg); }
.hero-section:hover { transform: scale(1.02); transition: transform 0.3s ease; }

### Layout blocks

Horizontal flex row:
<!-- wp:group {"layout":{"type":"flex","flexWrap":"nowrap","justifyContent":"space-between"}} -->

Vertical stack:
<!-- wp:group {"layout":{"type":"flex","orientation":"vertical"}} -->

CSS grid (equal columns):
<!-- wp:group {"layout":{"type":"grid","columnCount":3}} -->

CSS grid (custom template):
<!-- wp:group {"layout":{"type":"grid","columnCount":null,"minimumColumnWidth":null},"style":{"layout":{"columnSpan":2}}} -->

Columns with ratios:
<!-- wp:columns --><!-- wp:column {"width":"66.66%"} -->...<!-- /wp:column --><!-- wp:column {"width":"33.33%"} -->...<!-- /wp:column --><!-- /wp:columns -->

### HTML element → block mapping

<h1>–<h6> → core/heading (level attr)
<p> → core/paragraph
<img> → core/image (id, url, alt attrs; className + CSS for effects)
<ul>/<ol> → core/list + core/list-item
<blockquote> → core/quote
<a> styled as button → core/buttons > core/button
<div> wrapper/section → core/group (className for CSS targeting)
<hr> → core/separator
empty spacing → core/spacer (height attr, e.g. {"height":"4rem"})
<video> → core/video
<table> → core/table
<figure> with caption → core/image or core/media-text

### Rules

- Only use core/html for: inline SVGs, <form> elements, <script> tags, interactive widgets with no block equivalent.
- Never use core/html for text, headings, layout sections, images, or lists.
- Never use inline style attributes in block HTML content.
- Use core/spacer for empty spacing, not empty core/group blocks.
- Custom class names go on the block's className attribute, never on inner DOM elements.`;

const htmlToBlocksTool = tool(
	'html_to_blocks',
	'Returns guidelines for converting raw HTML into WordPress block markup. ' +
		'Reads the HTML input and provides the conversion reference (block equivalents, ' +
		'attribute patterns, layout blocks). You do the actual conversion yourself using these guidelines. ' +
		'After converting, use validate_blocks to verify and take_screenshot to check visual fidelity.',
	{
		filePath: z.string().optional().describe( 'Path to a file containing HTML to convert' ),
		content: z.string().optional().describe( 'Raw HTML content to convert into blocks' ),
	},
	async ( args ) => {
		try {
			let htmlContent: string;
			let fileName = 'inline content';

			if ( args.filePath ) {
				htmlContent = await readFile( args.filePath, 'utf-8' );
				fileName = args.filePath.split( '/' ).slice( -2 ).join( '/' );
			} else if ( args.content ) {
				htmlContent = args.content;
			} else {
				return errorResult( 'Either content or filePath must be provided.' );
			}

			emitProgress( `Loading block conversion guidelines for ${ fileName }…` );

			const lines = [
				'# HTML to blocks conversion',
				'',
				'Convert the following HTML into WordPress block markup using the guidelines below.',
				'After converting, validate with validate_blocks and verify visually with take_screenshot.',
				'',
				'--- Source HTML ---',
				'',
				htmlContent,
				'',
				BLOCK_CONVERSION_GUIDELINES,
			];

			return textResult( lines.join( '\n' ) );
		} catch ( error ) {
			return errorResult(
				`Failed to read HTML: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
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
	htmlToBlocksTool,
	takeScreenshotTool,
];

export function createStudioTools() {
	return createSdkMcpServer( {
		name: 'studio',
		version: '1.0.0',
		tools: studioToolDefinitions,
	} );
}
