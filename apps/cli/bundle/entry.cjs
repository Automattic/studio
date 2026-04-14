/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Bundle entry point for the standalone CLI binary.
 *
 * Uses Node.js Single Executable Application to embed assets. CJS format
 * is required (Node 24 doesn't support ESM in this context).
 *
 *   1. Detects bundled mode via node:sea.isSea()
 *   2. On first run, extracts embedded assets to the CLI directory
 *   3. import()s the CLI's main.mjs
 *
 * The extraction path defaults to ~/.studio/cli/ but can be overridden
 * via the STUDIO_CLI_DIR environment variable. This allows the Studio
 * desktop app to extract to its own Resources directory.
 *
 * Assets embedded in the binary:
 *   - node_modules.tar.gz: Native/WASM packages needed at runtime
 *   - cli.tar.gz: The CLI bundle (main.mjs + chunks + wp-files)
 */
'use strict';

const { execSync } = require( 'node:child_process' );
const {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} = require( 'node:fs' );
const { homedir } = require( 'node:os' );
const { join, sep } = require( 'node:path' );
const { isSea, getAsset } = require( 'node:sea' );
const { pathToFileURL } = require( 'node:url' );

// Convert Windows backslash paths to forward slashes for tar compatibility
const posix = ( p ) => p.split( sep ).join( '/' );

const DEFAULT_CLI_DIR = join( homedir(), '.studio', 'cli' );
const CLI_DIR = process.env.STUDIO_CLI_DIR || DEFAULT_CLI_DIR;
const NODE_MODULES_DIR = join( CLI_DIR, 'node_modules' );
const MARKER_FILE = join( CLI_DIR, '.bundle-version' );

// Bump this to force re-extraction when the binary is updated
const BUNDLE_VERSION = '0.0.1';

async function main() {
	if ( ! isSea() ) {
		console.error( 'This binary must be run as a bundled executable.' );
		process.exit( 1 );
	}

	const needsExtract =
		! existsSync( MARKER_FILE ) || readFileSync( MARKER_FILE, 'utf8' ).trim() !== BUNDLE_VERSION;

	if ( needsExtract ) {
		console.log( 'First run — extracting runtime assets...' );

		// Extract CLI bundle
		const parentDir = join( CLI_DIR, '..' );
		mkdirSync( parentDir, { recursive: true } );
		const cliBundleTar = Buffer.from( getAsset( 'cli.tar.gz' ) );
		const cliTarPath = join( parentDir, 'cli.tar.gz' );
		writeFileSync( cliTarPath, cliBundleTar );

		if ( existsSync( CLI_DIR ) ) {
			rmSync( CLI_DIR, { recursive: true, force: true } );
		}
		mkdirSync( CLI_DIR, { recursive: true } );
		execSync( `tar -xzf "${ posix( cliTarPath ) }" --force-local -C "${ posix( CLI_DIR ) }"`, {
			stdio: 'inherit',
		} );
		unlinkSync( cliTarPath );

		// Extract node_modules alongside the CLI bundle
		const nodeModulesTar = Buffer.from( getAsset( 'node_modules.tar.gz' ) );
		const tarPath = join( parentDir, 'node_modules.tar.gz' );
		writeFileSync( tarPath, nodeModulesTar );

		if ( existsSync( NODE_MODULES_DIR ) ) {
			rmSync( NODE_MODULES_DIR, { recursive: true, force: true } );
		}
		mkdirSync( NODE_MODULES_DIR, { recursive: true } );
		execSync(
			`tar -xzf "${ posix( tarPath ) }" --force-local -C "${ posix( NODE_MODULES_DIR ) }"`,
			{
				stdio: 'inherit',
			}
		);
		unlinkSync( tarPath );

		writeFileSync( MARKER_FILE, BUNDLE_VERSION );
		console.log( 'Extraction complete.' );
	}

	// When spawned as a child process (e.g. daemon spawning wp-server),
	// process.execPath points to this binary. The child passes a script
	// path as an arg. Detect this and run that script directly.
	// In bundled mode, argv layout is [binaryPath, binaryPath, ...userArgs] —
	// Node duplicates the binary path at argv[1]. This is fine for the CLI
	// (yargs reads from argv[2]).
	//
	// argv may contain Node flags before the script path:
	//   [binary, binary, --experimental-wasm-jspi, script.mjs, ...args]
	// Scan for a .mjs file path to detect child process mode.
	const scriptIndex = process.argv.findIndex(
		( arg, i ) => i >= 2 && arg.endsWith( '.mjs' ) && existsSync( arg )
	);

	if ( scriptIndex >= 0 ) {
		// Child process mode: run the script directly
		process.argv = [
			process.argv[ 0 ],
			process.argv[ scriptIndex ],
			...process.argv.slice( scriptIndex + 1 ),
		];
		await import( pathToFileURL( process.argv[ 1 ] ).href );
		return;
	}

	// Normal CLI mode: argv is [binary, binary, ...cliArgs] — keep as-is
	const cliEntry = pathToFileURL( join( CLI_DIR, 'main.mjs' ) ).href;
	await import( cliEntry );
}

main().catch( ( err ) => {
	console.error( 'Fatal:', err );
	process.exit( 1 );
} );
