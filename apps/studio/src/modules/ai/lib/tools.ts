import path from 'path';
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { SiteServer } from 'src/site-server';
import { browserToolDefinitions } from './browser-tools';

export function errorResult( message: string ) {
	return {
		content: [ { type: 'text' as const, text: message } ],
		isError: true,
	};
}

export function textResult( text: string ) {
	return {
		content: [ { type: 'text' as const, text } ],
	};
}

/**
 * Find a site by display name or directory name (path basename).
 * Allows the agent to use either "Next to Kin" or "my-serene-website".
 */
export function findSiteByName( name: string ) {
	const sites = SiteServer.getAllDetails();
	const lower = name.toLowerCase();
	return (
		sites.find( ( s ) => s.name.toLowerCase() === lower ) ??
		sites.find( ( s ) => path.basename( s.path ).toLowerCase() === lower ) ??
		null
	);
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
		const site = findSiteByName( args.name );
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
		const site = findSiteByName( args.name );
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
		const site = findSiteByName( args.name );
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
		const site = findSiteByName( args.name );
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

/**
 * Helper: find a running site's server by name, or throw with a descriptive message.
 */
function getRunningSiteServer( name: string ): SiteServer {
	const site = findSiteByName( name );
	if ( ! site ) {
		throw new Error( `Site "${ name }" not found. Use site_list to see available sites.` );
	}
	if ( ! site.running ) {
		throw new Error( `Site "${ site.name }" is not running. Use site_start first.` );
	}
	const server = SiteServer.get( site.id );
	if ( ! server ) {
		throw new Error( `Could not find server for site "${ site.name }".` );
	}
	return server;
}

const postBlocksReadTool = tool(
	'post_blocks_read',
	'List all Gutenberg blocks in a WordPress post or page, with their index, type, and a content preview. Use this to understand page structure before editing specific blocks with post_block_update.',
	{
		name: z.string().describe( 'The name of the site' ),
		post_id: z.number().describe( 'The post or page ID' ),
	},
	async ( args ) => {
		let server: SiteServer;
		try {
			server = getRunningSiteServer( args.name );
		} catch ( error ) {
			return errorResult( error instanceof Error ? error.message : String( error ) );
		}

		const php = `
$post = get_post( ${ args.post_id } );
if ( ! $post ) { echo json_encode( [ 'error' => 'Post not found' ] ); exit; }
$blocks = parse_blocks( $post->post_content );
$output = [];
$index = 0;
foreach ( $blocks as $block ) {
	if ( empty( $block['blockName'] ) ) {
		$index++;
		continue;
	}
	$preview = wp_strip_all_tags( $block['innerHTML'] );
	$preview = preg_replace( '/\\s+/', ' ', trim( $preview ) );
	if ( strlen( $preview ) > 200 ) { $preview = substr( $preview, 0, 197 ) . '...'; }
	$entry = [
		'index' => $index,
		'type'  => $block['blockName'],
	];
	if ( ! empty( $block['attrs'] ) ) { $entry['attrs'] = $block['attrs']; }
	if ( $preview !== '' ) { $entry['preview'] = $preview; }
	if ( ! empty( $block['innerBlocks'] ) ) { $entry['innerBlockCount'] = count( $block['innerBlocks'] ); }
	$output[] = $entry;
	$index++;
}
echo json_encode( $output, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
`;

		try {
			const cliResult = await server.executeWpCliCommand( [ 'eval', php.trim() ] );
			if ( cliResult.stderr ) {
				return errorResult( cliResult.stderr );
			}
			return textResult( cliResult.stdout || 'No blocks found.' );
		} catch ( error ) {
			return errorResult(
				`Failed to read blocks: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);

const postBlockUpdateTool = tool(
	'post_block_update',
	'Replace a specific Gutenberg block in a post or page by its index. Use post_blocks_read first to find the target block index. The new_markup should be valid block markup (e.g. <!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->).',
	{
		name: z.string().describe( 'The name of the site' ),
		post_id: z.number().describe( 'The post or page ID' ),
		block_index: z.number().describe( 'The block index (from post_blocks_read) to replace' ),
		new_markup: z.string().describe( 'The new block markup to replace the block with' ),
	},
	async ( args ) => {
		let server: SiteServer;
		try {
			server = getRunningSiteServer( args.name );
		} catch ( error ) {
			return errorResult( error instanceof Error ? error.message : String( error ) );
		}

		// Base64-encode the markup to avoid quoting/escaping issues in PHP
		const encodedMarkup = Buffer.from( args.new_markup ).toString( 'base64' );

		const php = `
$post = get_post( ${ args.post_id } );
if ( ! $post ) { echo json_encode( [ 'error' => 'Post not found' ] ); exit; }
$blocks = parse_blocks( $post->post_content );
$target = ${ args.block_index };
if ( ! isset( $blocks[ $target ] ) ) {
	echo json_encode( [ 'error' => 'Block index ' . $target . ' not found. Post has ' . count( $blocks ) . ' blocks.' ] );
	exit;
}
$new_markup = base64_decode( '${ encodedMarkup }' );
$new_blocks = parse_blocks( $new_markup );
if ( empty( $new_blocks ) ) {
	echo json_encode( [ 'error' => 'Could not parse the provided markup into a valid block.' ] );
	exit;
}
array_splice( $blocks, $target, 1, $new_blocks );
$content = serialize_blocks( $blocks );
$updated = wp_update_post( [
	'ID'           => ${ args.post_id },
	'post_content' => $content,
], true );
if ( is_wp_error( $updated ) ) {
	echo json_encode( [ 'error' => $updated->get_error_message() ] );
	exit;
}
echo 'Block ' . $target . ' updated successfully.';
`;

		try {
			const cliResult = await server.executeWpCliCommand( [ 'eval', php.trim() ] );
			if ( cliResult.stderr ) {
				return errorResult( cliResult.stderr );
			}
			const output = cliResult.stdout || '';
			// Check if the PHP returned a JSON error
			try {
				const parsed = JSON.parse( output );
				if ( parsed.error ) {
					return errorResult( parsed.error );
				}
			} catch {
				// Not JSON — it's the success message
			}
			return textResult( output );
		} catch ( error ) {
			return errorResult(
				`Failed to update block: ${ error instanceof Error ? error.message : String( error ) }`
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
	postBlocksReadTool,
	postBlockUpdateTool,
	...browserToolDefinitions,
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
