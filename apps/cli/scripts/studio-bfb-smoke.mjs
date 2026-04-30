#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname( fileURLToPath( import.meta.url ) );
const cliPath = resolve( scriptDir, '../dist/cli/main.mjs' );
const nodeBin = process.execPath;
const sitePath = process.env.STUDIO_BFB_SMOKE_SITE || resolve( tmpdir(), 'studio-bfb-smoke' );
const bfbPath = process.env.STUDIO_BFB_MU_PLUGIN_PATH;

if ( ! bfbPath ) {
	console.error( 'STUDIO_BFB_MU_PLUGIN_PATH is required.' );
	process.exit( 1 );
}

if ( ! existsSync( cliPath ) ) {
	console.error(
		`Built Studio CLI not found at ${ cliPath }. Run homeboy rig up studio-bfb first.`
	);
	process.exit( 1 );
}

function run( args, options = {} ) {
	const result = spawnSync( nodeBin, [ cliPath, ...args ], {
		encoding: 'utf8',
		env: { ...process.env, STUDIO_BFB_MU_PLUGIN_PATH: bfbPath },
		...options,
	} );

	if ( result.status !== 0 ) {
		if ( result.stdout ) {
			process.stdout.write( result.stdout );
		}
		if ( result.stderr ) {
			process.stderr.write( result.stderr );
		}
		throw new Error( `${ args.join( ' ' ) } exited ${ result.status }` );
	}

	return result;
}

function ensureSite() {
	const status = spawnSync(
		nodeBin,
		[ cliPath, 'site', 'status', '--path', sitePath, '--format', 'json' ],
		{
			encoding: 'utf8',
			env: { ...process.env, STUDIO_BFB_MU_PLUGIN_PATH: bfbPath },
		}
	);

	if ( status.status === 0 ) {
		return;
	}

	run( [
		'site',
		'create',
		'--name',
		'BFB Mu Plugin Smoke',
		'--path',
		sitePath,
		'--skip-browser',
		'--skip-log-details',
	] );
}

function stopSite() {
	spawnSync( nodeBin, [ cliPath, 'site', 'stop', '--path', sitePath ], {
		encoding: 'utf8',
		env: { ...process.env, STUDIO_BFB_MU_PLUGIN_PATH: bfbPath },
	} );
}

const php = `
update_option( 'studio_bfb_unsupported_fallback_count', 0, false );

$results = array();
$results['bfb_loaded'] = function_exists( 'bfb_convert' );
$results['h2bc_loaded'] = function_exists( 'BlockFormatBridge\\Vendor\\html_to_blocks_raw_handler' );
$results['write_hook'] = (bool) has_filter( 'wp_insert_post_data', 'BlockFormatBridge\\Vendor\\html_to_blocks_convert_on_insert' );

$page_html = '<section class="hero"><h1>Deterministic Blocks</h1><p>Raw semantic HTML should become editable blocks.</p><ul><li>Fast</li><li>Native</li></ul><p><a class="wp-element-button" href="/#start">Start</a></p></section>';
$page_id = wp_insert_post( array(
	'post_title'   => 'BFB smoke page ' . time(),
	'post_type'    => 'page',
	'post_status'  => 'publish',
	'post_content' => $page_html,
) );
if ( is_wp_error( $page_id ) ) {
	throw new RuntimeException( $page_id->get_error_message() );
}
$page_stored = get_post_field( 'post_content', $page_id );

$template_html = '<main class="site-shell"><section class="hero"><h1>Clean Block Template Smoke</h1><p>No fallback should fire.</p></section></main>';
$template_id = wp_insert_post( array(
	'post_title'   => 'bfb-smoke//main-' . time(),
	'post_name'    => 'bfb-smoke//main-' . time(),
	'post_type'    => 'wp_template',
	'post_status'  => 'publish',
	'post_content' => $template_html,
) );
if ( is_wp_error( $template_id ) ) {
	throw new RuntimeException( $template_id->get_error_message() );
}
$template_stored = get_post_field( 'post_content', $template_id );

$results['page_has_blocks'] = false !== strpos( $page_stored, '<!-- wp:' );
$results['template_has_blocks'] = false !== strpos( $template_stored, '<!-- wp:' );
$results['page_html_blocks'] = substr_count( $page_stored, 'wp:html' );
$results['template_html_blocks'] = substr_count( $template_stored, 'wp:html' );
$results['fallback_count'] = (int) get_option( 'studio_bfb_unsupported_fallback_count', 0 );
$results['page_id'] = $page_id;
$results['template_id'] = $template_id;

echo wp_json_encode( $results, JSON_PRETTY_PRINT ) . PHP_EOL;

foreach ( array( 'bfb_loaded', 'h2bc_loaded', 'write_hook', 'page_has_blocks', 'template_has_blocks' ) as $key ) {
	if ( empty( $results[ $key ] ) ) {
		throw new RuntimeException( 'Smoke failed: ' . $key );
	}
}

if ( 0 !== $results['fallback_count'] ) {
	throw new RuntimeException( 'Smoke failed: fallback_count=' . $results['fallback_count'] );
}

if ( 0 !== $results['page_html_blocks'] || 0 !== $results['template_html_blocks'] ) {
	throw new RuntimeException( 'Smoke failed: core/html fallback block present' );
}
`;

try {
	ensureSite();
	stopSite();
	const result = run( [ 'wp', '--path', sitePath, '--php-version', '8.3', 'eval', php ] );
	process.stdout.write( result.stdout );
	if ( result.stderr ) {
		process.stderr.write( result.stderr );
	}
	console.log( 'PASS: Studio/BFB raw HTML write path stores native blocks.' );
} catch ( error ) {
	console.error( error instanceof Error ? error.message : String( error ) );
	process.exit( 1 );
}
