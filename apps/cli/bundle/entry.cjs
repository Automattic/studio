/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Bundle entry point for the standalone CLI binary.
 *
 * Uses Node.js Single Executable Application to embed the entry bundle. CJS
 * format is required (Node 24 doesn't support ESM in this context).
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
 *   - bundle-version: SHA-256 fingerprint of embedded assets and the sidecar.
 *     When any runtime asset changes, this value changes, triggering
 *     re-extraction.
 *
 * Assets shipped next to the binary:
 *   - {binary}.node_modules.tar.gz: Native/WASM packages Vite leaves as bare
 *     imports. Keeping this out of the SEA blob avoids postject's large-asset
 *     abort on Linux.
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
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
	writeSync,
} = require( 'node:fs' );
const { homedir } = require( 'node:os' );
const { basename, dirname, join, sep } = require( 'node:path' );
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
// Backstop only: a lock is normally reclaimed the instant its owner PID is
// gone (see isLockStale). This guards the rare case of PID reuse keeping a
// dead owner's lock alive-looking.
const STALE_LOCK_BACKSTOP_MS = 10 * 60_000;

const sleep = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

function isProcessAlive( pid ) {
	if ( ! Number.isInteger( pid ) || pid <= 0 ) {
		return false;
	}
	try {
		// Signal 0 runs existence/permission checks without delivering a signal.
		process.kill( pid, 0 );
		return true;
	} catch ( err ) {
		// EPERM => the process exists but is owned by another user.
		return err.code === 'EPERM';
	}
}

// Decide whether an existing lock can be reclaimed. We key on the owner PID so a
// long (synchronous) extraction by a live owner is never broken, while a crashed
// owner is reclaimed at once. Extraction runs synchronously via execSync, so a
// timer-based heartbeat couldn't refresh the lock mid-extraction anyway.
function isLockStale() {
	let pid = NaN;
	try {
		pid = parseInt( readFileSync( LOCK_FILE, 'utf8' ).trim(), 10 );
	} catch {
		// Unreadable: fall through to the mtime backstop below.
	}

	// A readable PID that is no longer running means the owner crashed.
	if ( Number.isInteger( pid ) && pid > 0 && ! isProcessAlive( pid ) ) {
		return true;
	}

	// PID not yet written (lock just created) or owner still alive: only reclaim
	// if the lock is absurdly old, as a guard against PID reuse.
	try {
		const stats = statSync( LOCK_FILE );
		return Date.now() - stats.mtimeMs > STALE_LOCK_BACKSTOP_MS;
	} catch {
		// Lock vanished between attempts; treat as free.
		return true;
	}
}

// Coordinate concurrent first-runs with a single lockfile. openSync('wx')
// is an atomic "create if not exists" so only one process can hold it.
async function acquireLock() {
	const deadline = Date.now() + STALE_LOCK_BACKSTOP_MS;
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
		if ( isLockStale() ) {
			rmSync( LOCK_FILE, { force: true } );
			continue;
		}
		await sleep( 200 );
	}
	throw new Error( `Timed out waiting for ${ LOCK_FILE }.` );
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

function extractTarBuffer( tarball, destDir, sourceLabel ) {
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
				input: tarball,
				stdio: [ 'pipe', 'inherit', 'inherit' ],
			} );
		} catch ( err ) {
			throw new Error(
				`Failed to extract ${ sourceLabel } with tar. Make sure 'tar' is installed and on PATH. Original error: ${ err.message }`
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

function extractSeaTarAsset( assetName, destDir ) {
	extractTarBuffer( Buffer.from( getAsset( assetName ) ), destDir, assetName );
}

function getNodeModulesSidecarCandidates() {
	const execPaths = [ process.execPath ];
	try {
		const realExecPath = realpathSync( process.execPath );
		if ( ! execPaths.includes( realExecPath ) ) {
			execPaths.push( realExecPath );
		}
	} catch {
		// If the executable path cannot be resolved, the original path is still useful.
	}

	const binDirs = [ ...new Set( execPaths.map( dirname ) ) ];
	return [
		...execPaths.map( ( execPath ) => `${ execPath }.node_modules.tar.gz` ),
		...binDirs.flatMap( ( binDir ) => [
			join( binDir, 'studio.node_modules.tar.gz' ),
			join( binDir, 'studio.exe.node_modules.tar.gz' ),
		] ),
	];
}

function getNodeModulesSidecarPath() {
	const candidates = getNodeModulesSidecarCandidates();
	const sidecarPath = candidates.find( existsSync );
	if ( ! sidecarPath ) {
		throw new Error(
			`Missing node_modules sidecar. Expected one of: ${ candidates.join( ', ' ) }`
		);
	}
	return sidecarPath;
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

		// Progress goes to stderr so it never pollutes stdout that capture-mode
		// callers parse (e.g. `--version`, `--format json`) on first run.
		console.error( 'First run — extracting runtime assets...' );
		sweepStaleTmpDirs();

		// Order matters: extracting resources.tar.gz atomically replaces CLI_DIR,
		// so main.mjs has to be written afterwards. node_modules extracts into a
		// subdir and can happen in either order, but we do it last for consistency.
		extractSeaTarAsset( 'resources.tar.gz', CLI_DIR );
		writeFileSync( join( CLI_DIR, 'main.mjs' ), Buffer.from( getAsset( 'main.mjs' ) ) );
		const nodeModulesSidecarPath = getNodeModulesSidecarPath();
		extractTarBuffer(
			readFileSync( nodeModulesSidecarPath ),
			join( CLI_DIR, 'node_modules' ),
			nodeModulesSidecarPath
		);

		writeFileSync( MARKER_FILE, bundleVersion );
		console.error( 'Extraction complete.' );
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
	// Every internal child is spawned with our own entrypoint (main.mjs) as the
	// script path, so match that basename specifically rather than any *.mjs — a
	// user-supplied argument that merely ends in .mjs must not be mistaken for
	// child-process mode.
	const scriptIndex = process.argv.findIndex(
		( arg, i ) => i >= 2 && basename( arg ) === 'main.mjs' && existsSync( arg )
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
