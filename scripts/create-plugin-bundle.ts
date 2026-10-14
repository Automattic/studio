#!/usr/bin/env -S node --experimental-strip-types
/**
 * Builds the WordPress Studio plugin with the Studio CLI inside, as the Automattic/studio-plugins
 * marketplace and OpenAI's plugin directory ship it. The CLI is the build the desktop app embeds
 * (WordPress and phpMyAdmin included, no Node.js: the plugin runs it with the host's), packed as
 * one brotli-compressed tarball that the plugin unpacks on first start. A single archive keeps the
 * package within the directory's limits, which this script checks.
 *
 * Output: standalone-bundles/wp-studio-<version>.zip
 *
 * Prerequisites: npm dependencies installed, language packs downloaded (`npm run download-language-packs`)
 *
 * NOTE: Like `cli:bundle`, this mutates `apps/cli/node_modules`; run `npm ci` to reset it.
 */

import { execFileSync, spawn } from 'child_process';
import { once } from 'events';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import zlib from 'zlib';

const repoRoot = path.join( import.meta.dirname, '..' );
const { version } = JSON.parse(
	fs.readFileSync( path.join( repoRoot, 'apps', 'cli', 'package.json' ), 'utf8' )
);
const outputDir = path.join( repoRoot, 'standalone-bundles' );
const stagingDir = path.join( outputDir, 'wp-studio' );
const zipPath = path.join( outputDir, `wp-studio-${ version }.zip` );

// OpenAI's checks on uploaded plugins.
const MiB = 1024 * 1024;
const LIMITS = { zip: 100 * MiB, unpacked: 512 * MiB, entries: 5000, entry: 100 * MiB };

async function main(): Promise< void > {
	console.log( '==> Building the CLI package...' );
	fs.rmSync( path.join( repoRoot, 'apps', 'cli', 'node_modules' ), {
		recursive: true,
		force: true,
	} );
	execFileSync( 'npm', [ 'run', 'cli:package' ], { cwd: repoRoot, stdio: 'inherit' } );

	console.log( '==> Assembling the plugin...' );
	fs.rmSync( stagingDir, { recursive: true, force: true } );
	fs.cpSync( path.join( repoRoot, 'plugins', 'wp-studio' ), stagingDir, { recursive: true } );
	const manifestPath = path.join( stagingDir, '.codex-plugin', 'plugin.json' );
	const manifest = JSON.parse( fs.readFileSync( manifestPath, 'utf8' ) );
	fs.writeFileSync( manifestPath, JSON.stringify( { ...manifest, version }, null, 2 ) + '\n' );

	// The same prunes as the desktop app and the standalone bundle: browser caches, and AI provider
	// SDKs that pi-ai loads lazily but Studio never uses.
	const tar = spawn(
		'tar',
		[
			'-c',
			'--no-xattrs',
			'--exclude=.cache',
			'--exclude=playwright/browsers',
			'--exclude=playwright-core/browsers',
			'--exclude=@mistralai',
			'--exclude=@aws-sdk',
			'--exclude=@aws-crypto',
			'--exclude=@smithy',
			'--exclude=@google/genai',
			'-C',
			path.join( repoRoot, 'apps', 'cli', 'dist' ),
			'cli',
		],
		{ stdio: [ 'ignore', 'pipe', 'inherit' ], env: { ...process.env, COPYFILE_DISABLE: '1' } }
	);
	const [ [ tarCode ] ] = await Promise.all( [
		once( tar, 'close' ),
		pipeline(
			tar.stdout,
			zlib.createBrotliCompress( {
				params: {
					[ zlib.constants.BROTLI_PARAM_QUALITY ]: 9,
					[ zlib.constants.BROTLI_PARAM_LGWIN ]: 24,
				},
			} ),
			fs.createWriteStream( path.join( stagingDir, 'cli.tar.br' ) )
		),
	] );
	if ( tarCode !== 0 ) {
		throw new Error( `tar exited with code ${ tarCode }` );
	}

	console.log( '==> Zipping...' );
	fs.rmSync( zipPath, { force: true } );
	execFileSync( 'zip', [ '-r', '-X', '-q', zipPath, '.' ], { cwd: stagingDir, stdio: 'inherit' } );

	const entries = fs.readdirSync( stagingDir, { recursive: true, withFileTypes: true } );
	const sizes = entries
		.filter( ( entry ) => entry.isFile() )
		.map( ( entry ) => fs.statSync( path.join( entry.parentPath, entry.name ) ).size );
	const measured = {
		zip: fs.statSync( zipPath ).size,
		unpacked: sizes.reduce( ( total, size ) => total + size, 0 ),
		entries: entries.length,
		entry: Math.max( ...sizes ),
	};
	fs.rmSync( stagingDir, { recursive: true, force: true } );

	const over = Object.keys( LIMITS ).filter(
		( key ) => measured[ key as keyof typeof LIMITS ] > LIMITS[ key as keyof typeof LIMITS ]
	);
	console.log(
		`==> ${ zipPath }: ${ ( measured.zip / MiB ).toFixed( 1 ) } MiB, ${ (
			measured.unpacked / MiB
		).toFixed( 1 ) } MiB unpacked, ${ measured.entries } entries, largest ${ (
			measured.entry / MiB
		).toFixed( 1 ) } MiB`
	);
	if ( over.length ) {
		throw new Error( `Over OpenAI's plugin limits: ${ over.join( ', ' ) }` );
	}
}

main().catch( ( error ) => {
	console.error( 'Error:', error.message );
	process.exit( 1 );
} );
