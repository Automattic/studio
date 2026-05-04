// Post-build steps for the studio-panels plugin.
//
// 1. Drop a stub `build/modules/boot/index.min.asset.php` so wp-build's
//    generated page-wp-admin.php template stops short-circuiting its enqueue.
//    The template assumes you bundle your own copy of `@wordpress/boot`
//    (Gutenberg's monorepo case). We don't — Gutenberg provides it. The stub
//    just lists boot's classic-script dependencies so the prerequisites
//    `<script>` registers them, then leaves the actual `@wordpress/boot`
//    script module to resolve at runtime via Gutenberg's importmap entry.
//
// 2. Write `version.txt` next to the plugin so the CLI installer can
//    detect when to re-copy.

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );

// Classic-script dependencies that Gutenberg's `@wordpress/boot` module needs
// (read from Gutenberg ~23.0.1's `build/modules/boot/index.min.asset.php`).
// These are the `wp-*` script handles WP Core / Gutenberg already register.
// Keep in sync with the Gutenberg version Studio installs alongside the panels.
const BOOT_CLASSIC_DEPS = [
	'react',
	'react-dom',
	'react-jsx-runtime',
	'wp-commands',
	'wp-components',
	'wp-compose',
	'wp-core-data',
	'wp-data',
	'wp-editor',
	'wp-element',
	'wp-html-entities',
	'wp-i18n',
	'wp-keyboard-shortcuts',
	'wp-keycodes',
	'wp-notices',
	'wp-primitives',
	'wp-private-apis',
	'wp-theme',
	'wp-url',
];

const bootAssetDir = path.join( root, 'build', 'modules', 'boot' );
mkdirSync( bootAssetDir, { recursive: true } );
const bootAssetContents =
	"<?php return array('dependencies' => array(" +
	BOOT_CLASSIC_DEPS.map( ( d ) => `'${ d }'` ).join( ', ' ) +
	"), 'module_dependencies' => array(), 'version' => '0');";
writeFileSync( path.join( bootAssetDir, 'index.min.asset.php' ), bootAssetContents );

const pkg = JSON.parse( readFileSync( path.join( root, 'package.json' ), 'utf8' ) );
writeFileSync( path.join( root, 'version.txt' ), pkg.version );

console.log( '✔ post-build: wrote stub boot asset + version.txt' );
