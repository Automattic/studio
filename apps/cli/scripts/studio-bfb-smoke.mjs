#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname( fileURLToPath( import.meta.url ) );
const cliPath = resolve( scriptDir, '../dist/cli/main.mjs' );
const nodeBin = process.execPath;
const sitePath =
	process.env.STUDIO_STATIC_SITE_IMPORTER_SMOKE_SITE ||
	resolve( tmpdir(), 'studio-static-site-importer-smoke' );

if ( ! existsSync( cliPath ) ) {
	console.error(
		`Built Studio CLI not found at ${ cliPath }. Run homeboy rig up studio-bfb first.`
	);
	process.exit( 1 );
}

function run( args, options = {} ) {
	const result = spawnSync( nodeBin, [ cliPath, ...args ], {
		encoding: 'utf8',
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
		{ encoding: 'utf8' }
	);

	if ( status.status !== 0 ) {
		run( [
			'site',
			'create',
			'--name',
			'Static Site Importer Smoke',
			'--path',
			sitePath,
			'--skip-browser',
			'--skip-log-details',
		] );
	}

	run( [ 'site', 'start', '--path', sitePath, '--skip-browser' ] );
}

function stopSite() {
	spawnSync( nodeBin, [ cliPath, 'site', 'stop', '--path', sitePath ], {
		encoding: 'utf8',
	} );
}

function writeStaticFixture() {
	const fixtureDir = resolve( sitePath, 'tmp/static-site-importer-smoke' );
	mkdirSync( fixtureDir, { recursive: true } );
	writeFileSync(
		resolve( fixtureDir, 'index.html' ),
		`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Static Importer Smoke</title>
  <style>
    :root { --bg: #101018; --text: #f7f7fb; --accent: #42e8c5; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; }
    .site-header, .site-footer { padding: 24px; border-color: rgba(255,255,255,.12); }
    .hero { padding: 72px 24px; }
    .cta { color: var(--bg); background: var(--accent); padding: 12px 18px; border-radius: 999px; }
  </style>
</head>
<body>
  <header class="site-header"><a class="brand" href="index.html">Studio Code</a><nav><a href="#start">Start</a></nav></header>
  <main>
    <section class="hero"><h1>Imported Static Site</h1><p>Static HTML should become editable block theme output.</p><a class="cta" href="#start">Start</a></section>
    <section id="start"><h2>Workflow</h2><ol><li>Generate HTML</li><li>Import theme</li><li>Edit blocks</li></ol></section>
  </main>
  <footer class="site-footer"><p>Built with Static Site Importer.</p></footer>
</body>
</html>
`,
		'utf8'
	);
}

const php = `
update_option( 'studio_bfb_unsupported_fallback_count', 0, false );

$results = array();
$results['importer_loaded'] = class_exists( 'Static_Site_Importer_Theme_Generator' );
$results['bfb_loaded'] = function_exists( 'bfb_convert' );
$results['h2bc_loaded'] = function_exists( 'BlockFormatBridge\\Vendor\\html_to_blocks_raw_handler' );

$html_path = ABSPATH . 'tmp/static-site-importer-smoke/index.html';
$result = Static_Site_Importer_Theme_Generator::import_theme( $html_path, array(
	'slug' => 'studio-static-importer-smoke',
	'name' => 'Studio Static Importer Smoke',
	'activate' => true,
	'overwrite' => true,
) );
if ( is_wp_error( $result ) ) {
	throw new RuntimeException( $result->get_error_message() );
}

$theme_dir = $result['theme_dir'];
$files = array(
	'parts/header.html',
	'parts/footer.html',
	'templates/front-page.html',
	'templates/page-home.html',
	'patterns/page-home.php',
	'style.css',
	'theme.json',
);
foreach ( $files as $file ) {
	$results['file:' . $file] = file_exists( $theme_dir . '/' . $file );
}

$home_page_id = $result['pages']['index.html'] ?? 0;
$results['front_page_id'] = (int) get_option( 'page_on_front', 0 );
$results['home_page_id'] = (int) $home_page_id;
$results['active_theme'] = get_stylesheet();
$results['fallback_count'] = (int) get_option( 'studio_bfb_unsupported_fallback_count', 0 );
$results['header_html_blocks'] = substr_count( (string) file_get_contents( $theme_dir . '/parts/header.html' ), 'wp:html' );
$results['footer_html_blocks'] = substr_count( (string) file_get_contents( $theme_dir . '/parts/footer.html' ), 'wp:html' );
$results['pattern_has_blocks'] = false !== strpos( (string) file_get_contents( $theme_dir . '/patterns/page-home.php' ), '<!-- wp:' );

echo wp_json_encode( $results, JSON_PRETTY_PRINT ) . PHP_EOL;

foreach ( array( 'importer_loaded', 'bfb_loaded', 'h2bc_loaded', 'pattern_has_blocks' ) as $key ) {
	if ( empty( $results[ $key ] ) ) {
		throw new RuntimeException( 'Smoke failed: ' . $key );
	}
}
foreach ( $files as $file ) {
	$key = 'file:' . $file;
	if ( empty( $results[ $key ] ) ) {
		throw new RuntimeException( 'Smoke failed missing file: ' . $file );
	}
}
if ( $results['front_page_id'] !== $results['home_page_id'] ) {
	throw new RuntimeException( 'Smoke failed: imported home page is not the front page' );
}
`;

try {
	ensureSite();
	writeStaticFixture();
	const result = run( [ 'wp', '--path', sitePath, '--php-version', '8.3', 'eval', php ] );
	process.stdout.write( result.stdout );
	if ( result.stderr ) {
		process.stderr.write( result.stderr );
	}
	console.log( 'PASS: Studio Static Site Importer smoke generated an editable block theme.' );
} catch ( error ) {
	console.error( error instanceof Error ? error.message : String( error ) );
	process.exit( 1 );
} finally {
	stopSite();
}
