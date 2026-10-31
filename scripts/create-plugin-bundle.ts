#!/usr/bin/env -S node --experimental-strip-types
/**
 * Builds the WordPress Studio plugin with the Studio CLI inside, as the Automattic/studio-plugins
 * marketplace and OpenAI's plugin directory ship it. The CLI is the build the desktop app embeds
 * (WordPress and phpMyAdmin included, no Node.js: the plugin runs it with the host's), packed as
 * one brotli-compressed tarball that the plugin unpacks on first start. A single archive keeps the
 * package within the directory's limits, which this script checks.
 *
 * Anthropic's directory takes far smaller plugins, so it gets the plugin without the CLI and
 * without Codex's files: it downloads the same tarball from the matching Studio release instead.
 *
 * Output: standalone-bundles/wp-studio-<version>.zip, the plugin for Anthropic's directory in
 * standalone-bundles/wp-studio-directory, and its CLI download, wp-studio-cli-<version>.tar.br,
 * to attach to the Studio release.
 *
 * Prerequisites: npm dependencies installed, language packs downloaded (`npm run download-language-packs`)
 *
 * NOTE: Like `cli:bundle`, this mutates `apps/cli/node_modules`; run `npm ci` to reset it.
 */

import { execFileSync, spawn } from 'child_process';
import { createHash } from 'crypto';
import { once } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { pipeline } from 'stream/promises';
import zlib from 'zlib';

const repoRoot = path.join( import.meta.dirname, '..' );
const { version } = JSON.parse(
	fs.readFileSync( path.join( repoRoot, 'apps', 'cli', 'package.json' ), 'utf8' )
);
const outputDir = path.join( repoRoot, 'standalone-bundles' );
const stagingDir = path.join( outputDir, 'wp-studio' );
const zipPath = path.join( outputDir, `wp-studio-${ version }.zip` );
const directoryDir = path.join( outputDir, 'wp-studio-directory' );
const cliAsset = `wp-studio-cli-${ version }.tar.br`;

// OpenAI's checks on uploaded plugins, and Anthropic's on a directory plugin's repository.
const MiB = 1024 * 1024;
const LIMITS = { zip: 100 * MiB, unpacked: 512 * MiB, entries: 5000, entry: 100 * MiB };
const DIRECTORY_LIMITS = { unpacked: 50 * MiB, entries: 512, entry: 5 * MiB };

// What only Codex reads: its manifest, MCP config, app metadata and screenshots. Both read the
// launchers, which run the hooks.
const CODEX_ONLY = [
	'.codex-plugin',
	'.mcp.json',
	'agents',
	'assets/screenshot-layout.png',
	'assets/screenshot-look.png',
];

// Codex gives a plugin's server about ten seconds to start, less than unpacking the CLI can take,
// so the plugin answers the handshake and the tool list from what `studio mcp` answers the app it
// targets with: Codex, or Claude Code for Anthropic's directory. Recorded with the plugin's MCP
// config environment, in a throwaway home with analytics off, which the plugin replaces with the
// user's in the tool descriptions. The plugin also reads its version from it.
async function recordMcpSnapshot( file: string, client: string, config: string ): Promise< void > {
	const home = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-mcp-snapshot-' ) );
	fs.mkdirSync( path.join( home, '.studio' ) );
	fs.writeFileSync(
		path.join( home, '.studio', 'shared.json' ),
		JSON.stringify( { analyticsOptOut: true } )
	);
	const { env } = JSON.parse( fs.readFileSync( config, 'utf8' ) ).mcpServers[ 'wordpress-studio' ];
	const server = spawn(
		process.execPath,
		[ path.join( repoRoot, 'apps', 'cli', 'dist', 'cli', 'main.mjs' ), 'mcp' ],
		{
			env: { ...process.env, ...env, HOME: home, USERPROFILE: home },
			stdio: [ 'pipe', 'pipe', 'inherit' ],
		}
	);
	const lines = readline.createInterface( { input: server.stdout } )[ Symbol.asyncIterator ]();
	const send = ( message: object ) =>
		server.stdin.write( JSON.stringify( { jsonrpc: '2.0', ...message } ) + '\n' );
	const request = async ( id: number, method: string, params: object = {} ) => {
		send( { id, method, params } );
		for (;;) {
			const message = JSON.parse( ( await lines.next() ).value );
			if ( message.id === id ) return message.result;
		}
	};
	const initialize = await request( 1, 'initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: client, version: '0' },
	} );
	send( { method: 'notifications/initialized' } );
	const snapshot = {
		version,
		home,
		initialize,
		tools: await request( 2, 'tools/list' ),
		resources: await request( 3, 'resources/list' ),
	};
	server.kill();
	fs.rmSync( home, { recursive: true, force: true } );
	fs.writeFileSync( file, JSON.stringify( snapshot ) );
}

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
	for ( const host of [ '.codex-plugin', '.claude-plugin' ] ) {
		const manifestPath = path.join( stagingDir, host, 'plugin.json' );
		const manifest = JSON.parse( fs.readFileSync( manifestPath, 'utf8' ) );
		fs.writeFileSync( manifestPath, JSON.stringify( { ...manifest, version }, null, 2 ) + '\n' );
	}
	await recordMcpSnapshot(
		path.join( stagingDir, 'mcp-snapshot.json' ),
		'codex-mcp-client',
		path.join( stagingDir, '.mcp.json' )
	);

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
	const plugin = { zip: fs.statSync( zipPath ).size, ...measure( stagingDir ) };

	console.log( "==> Assembling the plugin for Anthropic's directory..." );
	const cliBundle = path.join( stagingDir, 'cli.tar.br' );
	const sha256 = createHash( 'sha256' ).update( fs.readFileSync( cliBundle ) ).digest( 'hex' );
	fs.rmSync( directoryDir, { recursive: true, force: true } );
	fs.cpSync( stagingDir, directoryDir, {
		recursive: true,
		filter: ( source ) =>
			! [ ...CODEX_ONLY, 'cli.tar.br' ].some(
				( entry ) => source === path.join( stagingDir, entry )
			),
	} );
	await recordMcpSnapshot(
		path.join( directoryDir, 'mcp-snapshot.json' ),
		'claude-code',
		path.join( directoryDir, '.claude-plugin', 'plugin.json' )
	);
	fs.writeFileSync(
		path.join( directoryDir, 'cli-download.json' ),
		JSON.stringify(
			{
				url: `https://github.com/Automattic/studio/releases/download/v${ version }/${ cliAsset }`,
				sha256,
			},
			null,
			2
		) + '\n'
	);
	fs.renameSync( cliBundle, path.join( outputDir, cliAsset ) );
	fs.rmSync( stagingDir, { recursive: true, force: true } );

	report( zipPath, plugin, LIMITS, "OpenAI's plugin limits" );
	report( directoryDir, measure( directoryDir ), DIRECTORY_LIMITS, "Anthropic's directory limits" );
}

function measure( dir: string ) {
	const entries = fs.readdirSync( dir, { recursive: true, withFileTypes: true } );
	const sizes = entries
		.filter( ( entry ) => entry.isFile() )
		.map( ( entry ) => fs.statSync( path.join( entry.parentPath, entry.name ) ).size );
	return {
		unpacked: sizes.reduce( ( total, size ) => total + size, 0 ),
		entries: entries.length,
		entry: Math.max( ...sizes ),
	};
}

function report(
	output: string,
	measured: Record< string, number >,
	limits: Record< string, number >,
	name: string
) {
	const summary = Object.entries( measured ).map( ( [ key, value ] ) =>
		key === 'entries' ? `${ value } entries` : `${ key } ${ ( value / MiB ).toFixed( 1 ) } MiB`
	);
	console.log( `==> ${ output }: ${ summary.join( ', ' ) }` );
	const over = Object.keys( limits ).filter( ( key ) => measured[ key ] > limits[ key ] );
	if ( over.length ) {
		throw new Error( `Over ${ name }: ${ over.join( ', ' ) }` );
	}
}

main().catch( ( error ) => {
	console.error( 'Error:', error.message );
	process.exit( 1 );
} );
