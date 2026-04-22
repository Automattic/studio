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
 *   - main.mjs: Raw CLI bundle (Vite builds a single-file ESM).
 *   - resources.tar.gz: wp-files/ and other runtime static assets that live
 *     in dist/cli alongside main.mjs.
 *   - node_modules.tar.gz: Native/WASM packages Vite leaves as bare imports.
 *   - bundle-version: SHA-256 fingerprint of the assets above. When the
 *     binary changes, this value changes, triggering re-extraction.
 */
'use strict';

const { execSync } = require( 'node:child_process' );
const {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
	writeSync,
} = require( 'node:fs' );
const { homedir } = require( 'node:os' );
const { join, sep } = require( 'node:path' );
const { isSea, getAsset } = require( 'node:sea' );
const { pathToFileURL } = require( 'node:url' );

// We drive tar via stdin rather than passing the archive path as an argv
// entry. That keeps "C:" out of tar's arguments, so GNU tar (Git Bash on
// Windows) doesn't try to resolve the drive letter as a remote host. BSD tar
// handles either form, so this works cross-platform.

const DEFAULT_CLI_DIR = join( homedir(), '.studio', 'cli' );
const CLI_DIR = process.env.STUDIO_CLI_DIR || DEFAULT_CLI_DIR;
const PARENT_DIR = join( CLI_DIR, '..' );
const MARKER_FILE = join( CLI_DIR, '.bundle-version' );
const LOCK_FILE = `${ CLI_DIR }.lock`;
const STALE_LOCK_MS = 60_000;

const sleep = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

// Coordinate concurrent first-runs with a single lockfile. openSync('wx')
// is an atomic "create if not exists" so only one process can hold it.
// A stale lock (owning process died mid-extraction) is broken after STALE_LOCK_MS.
async function acquireLock() {
	const deadline = Date.now() + STALE_LOCK_MS * 2;
	while ( Date.now() < deadline ) {
		try {
			mkdirSync( PARENT_DIR, { recursive: true } );
			const fd = openSync( LOCK_FILE, 'wx' );
			writeSync( fd, String( process.pid ) );
			closeSync( fd );
			return;
		} catch ( err ) {
			if ( err.code !== 'EEXIST' ) {
				throw err;
			}
		}
		try {
			const stats = statSync( LOCK_FILE );
			if ( Date.now() - stats.mtimeMs > STALE_LOCK_MS ) {
				rmSync( LOCK_FILE, { force: true } );
				continue;
			}
		} catch {
			// Lock vanished between attempts; retry immediately.
			continue;
		}
		await sleep( 200 );
	}
	throw new Error( `Timed out waiting for ${ LOCK_FILE } after ${ STALE_LOCK_MS * 2 }ms.` );
}

function releaseLock() {
	rmSync( LOCK_FILE, { force: true } );
}

// Remove orphaned `${CLI_DIR}.tmp-*` dirs left behind by killed/crashed runs.
function sweepStaleTmpDirs() {
	let entries;
	try {
		entries = readdirSync( PARENT_DIR );
	} catch {
		return;
	}
	const base = CLI_DIR.split( sep ).pop();
	for ( const name of entries ) {
		if ( name.startsWith( `${ base }.tmp-` ) ) {
			rmSync( join( PARENT_DIR, name ), { recursive: true, force: true } );
		}
	}
}

function extractTarAsset( assetName, destDir ) {
	// Extract into a sibling tmp dir first, then move it into place. The
	// surrounding lock serializes this across processes, so the window between
	// rm and rename can't be interleaved with another writer.
	const suffix = `.tmp-${ process.pid }`;
	const tmpDir = `${ destDir }${ suffix }`;

	let extractionSucceeded = false;
	try {
		if ( existsSync( tmpDir ) ) {
			rmSync( tmpDir, { recursive: true, force: true } );
		}
		mkdirSync( tmpDir, { recursive: true } );

		// Stream the asset to tar's stdin and extract in-place (cwd = tmpDir).
		// No paths in argv => no GNU-tar "Cannot connect to C:" failure.
		try {
			execSync( 'tar -xz', {
				cwd: tmpDir,
				input: Buffer.from( getAsset( assetName ) ),
				stdio: [ 'pipe', 'inherit', 'inherit' ],
			} );
		} catch ( err ) {
			throw new Error(
				`Failed to extract bundle with tar. Make sure 'tar' is installed and on PATH. Original error: ${ err.message }`
			);
		}

		if ( existsSync( destDir ) ) {
			rmSync( destDir, { recursive: true, force: true } );
		}
		renameSync( tmpDir, destDir );
		extractionSucceeded = true;
	} finally {
		if ( ! extractionSucceeded ) {
			rmSync( tmpDir, { recursive: true, force: true } );
		}
	}
}

async function ensureExtracted( bundleVersion ) {
	await acquireLock();
	try {
		// Re-check under the lock: another process may have extracted while we
		// were waiting.
		if (
			existsSync( MARKER_FILE ) &&
			readFileSync( MARKER_FILE, 'utf8' ).trim() === bundleVersion
		) {
			return;
		}

		console.log( 'First run — extracting runtime assets...' );
		sweepStaleTmpDirs();

		// Order matters: extracting resources.tar.gz atomically replaces CLI_DIR,
		// so main.mjs has to be written afterwards. node_modules extracts into a
		// subdir and can happen in either order, but we do it last for consistency.
		extractTarAsset( 'resources.tar.gz', CLI_DIR );
		writeFileSync( join( CLI_DIR, 'main.mjs' ), Buffer.from( getAsset( 'main.mjs' ) ) );
		extractTarAsset( 'node_modules.tar.gz', join( CLI_DIR, 'node_modules' ) );

		writeFileSync( MARKER_FILE, bundleVersion );
		console.log( 'Extraction complete.' );
	} finally {
		releaseLock();
	}
}

async function main() {
	if ( ! isSea() ) {
		console.error( 'This binary must be run as a bundled executable.' );
		process.exit( 1 );
	}

	const bundleVersion = Buffer.from( getAsset( 'bundle-version' ) ).toString( 'utf8' ).trim();
	const markerMatches =
		existsSync( MARKER_FILE ) && readFileSync( MARKER_FILE, 'utf8' ).trim() === bundleVersion;

	if ( ! markerMatches ) {
		await ensureExtracted( bundleVersion );
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
