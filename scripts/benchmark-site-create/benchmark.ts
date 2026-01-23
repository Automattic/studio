#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Benchmark script for comparing Studio CLI site creation vs raw Playground CLI.
 *
 * Usage:
 *   cd scripts/benchmark-site-create
 *   npm install
 *   npm run benchmark
 *
 * Or with options:
 *   npm run benchmark -- --rounds=5 --skip-playground --skip-studio
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import chalk from 'chalk';

// Catch unhandled errors
process.on( 'unhandledRejection', ( reason, promise ) => {
	console.error( chalk.red( 'Unhandled Rejection at:' ), promise, 'reason:', reason );
} );

process.on( 'uncaughtException', ( err ) => {
	console.error( chalk.red( 'Uncaught Exception:' ), err );
} );

// Configuration
const DEFAULT_ROUNDS = 3;
const STUDIO_ROOT = path.resolve( import.meta.dirname, '../..' );
const PLAYGROUND_CLI_BIN = process.platform === 'win32' ? 'wp-playground-cli.cmd' : 'wp-playground-cli';
const PLAYGROUND_CLI_PATH = path.resolve( import.meta.dirname, 'node_modules/.bin', PLAYGROUND_CLI_BIN );
const STUDIO_CLI_PATH = path.resolve( STUDIO_ROOT, 'dist/cli/main.js' );

function getBundledWordPressPath(): string {
	if ( process.platform === 'win32' ) {
		const appData = process.env.APPDATA;
		if ( ! appData ) {
			throw new Error( 'APPDATA environment variable not set' );
		}
		return path.join( appData, 'Studio', 'server-files', 'wordpress-versions', 'latest' );
	}
	return path.join( os.homedir(), 'Library', 'Application Support', 'Studio', 'server-files', 'wordpress-versions', 'latest' );
}

function copyDirSync( src: string, dest: string ): void {
	fs.mkdirSync( dest, { recursive: true } );
	const entries = fs.readdirSync( src, { withFileTypes: true } );

	for ( const entry of entries ) {
		const srcPath = path.join( src, entry.name );
		const destPath = path.join( dest, entry.name );

		if ( entry.isDirectory() ) {
			copyDirSync( srcPath, destPath );
		} else {
			fs.copyFileSync( srcPath, destPath );
		}
	}
}

interface BenchmarkResult {
	name: string;
	round: number;
	durationMs: number;
	success: boolean;
	error?: string;
}

interface BenchmarkSummary {
	name: string;
	rounds: number;
	successful: number;
	failed: number;
	minMs: number;
	maxMs: number;
	avgMs: number;
	medianMs: number;
}

function parseArgs(): { rounds: number; skipPlayground: boolean; skipStudio: boolean; useBundled: boolean } {
	const args = process.argv.slice( 2 );
	let rounds = DEFAULT_ROUNDS;
	let skipPlayground = false;
	let skipStudio = false;
	let useBundled = false;

	for ( const arg of args ) {
		if ( arg.startsWith( '--rounds=' ) ) {
			rounds = parseInt( arg.split( '=' )[ 1 ], 10 );
		} else if ( arg === '--skip-playground' ) {
			skipPlayground = true;
		} else if ( arg === '--skip-studio' ) {
			skipStudio = true;
		} else if ( arg === '--use-bundled' ) {
			useBundled = true;
		} else if ( arg === '--help' ) {
			console.log( `
Usage: npm run benchmark [options]

Options:
  --rounds=N          Number of test rounds (default: ${ DEFAULT_ROUNDS })
  --skip-playground   Skip Playground CLI benchmarks
  --skip-studio       Skip Studio CLI benchmarks
  --use-bundled       Use Studio's bundled WordPress files for Playground CLI
                      (for apples-to-apples comparison, requires Studio app installed)
  --help              Show this help message
` );
			process.exit( 0 );
		}
	}

	return { rounds, skipPlayground, skipStudio, useBundled };
}

function median( values: number[] ): number {
	if ( values.length === 0 ) return 0;
	const sorted = [ ...values ].sort( ( a, b ) => a - b );
	const mid = Math.floor( sorted.length / 2 );
	return sorted.length % 2 !== 0 ? sorted[ mid ] : ( sorted[ mid - 1 ] + sorted[ mid ] ) / 2;
}

function formatDuration( ms: number ): string {
	if ( ms < 1000 ) return `${ ms.toFixed( 0 ) }ms`;
	return `${ ( ms / 1000 ).toFixed( 2 ) }s`;
}

function createTempDir( prefix: string ): string {
	return fs.mkdtempSync( path.join( os.tmpdir(), `benchmark-${ prefix }-` ) );
}

function cleanupDir( dir: string ): void {
	if ( fs.existsSync( dir ) ) {
		fs.rmSync( dir, { recursive: true, force: true } );
	}
}

async function runCommand(
	command: string,
	args: string[],
	options: { cwd?: string; timeout?: number } = {}
): Promise<{ durationMs: number; success: boolean; error?: string }> {
	const start = performance.now();
	const timeout = options.timeout ?? 300000; // 5 minute default timeout

	return new Promise( ( resolve ) => {
		let proc: ChildProcess;
		let timedOut = false;
		let stdout = '';
		let stderr = '';

		const timeoutId = setTimeout( () => {
			timedOut = true;
			proc?.kill( 'SIGKILL' );
		}, timeout );

		proc = spawn( command, args, {
			cwd: options.cwd,
			stdio: [ 'ignore', 'pipe', 'pipe' ],
			env: { ...process.env, FORCE_COLOR: '0' },
		} );

		proc.stdout?.on( 'data', ( data ) => {
			stdout += data.toString();
		} );

		proc.stderr?.on( 'data', ( data ) => {
			stderr += data.toString();
		} );

		proc.on( 'close', ( code ) => {
			clearTimeout( timeoutId );
			const durationMs = performance.now() - start;

			if ( timedOut ) {
				resolve( { durationMs, success: false, error: 'Timeout' } );
			} else if ( code !== 0 ) {
				resolve( { durationMs, success: false, error: stderr || `Exit code ${ code }` } );
			} else {
				resolve( { durationMs, success: true } );
			}
		} );

		proc.on( 'error', ( err ) => {
			clearTimeout( timeoutId );
			const durationMs = performance.now() - start;
			resolve( { durationMs, success: false, error: err.message } );
		} );
	} );
}

async function waitForServer( port: number, timeoutMs = 30000 ): Promise<boolean> {
	const start = Date.now();
	while ( Date.now() - start < timeoutMs ) {
		try {
			const response = await fetch( `http://localhost:${ port }/` );
			if ( response.ok ) {
				return true;
			}
		} catch {
			// Server not ready yet
		}
		await new Promise( ( r ) => setTimeout( r, 500 ) );
	}
	return false;
}

async function killProcessOnPort( port: number ): Promise<void> {
	return new Promise( ( resolve ) => {
		try {
			if ( process.platform === 'win32' ) {
				execSync( `for /f "tokens=5" %a in ('netstat -aon ^| find ":${ port }"') do taskkill /F /PID %a`, {
					stdio: 'ignore',
				} );
			} else {
				execSync( `lsof -ti:${ port } | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' } );
			}
		} catch {
			// Process may not exist
		}
		// Give OS time to release the port
		setTimeout( resolve, 500 );
	} );
}

/**
 * Benchmark raw Playground CLI site creation.
 * This starts a server and waits for it to be ready, then kills it.
 */
async function benchmarkPlaygroundCLI( siteDir: string, port: number, useBundled: boolean = false ): Promise<{ durationMs: number; success: boolean; error?: string }> {
	// If using bundled files, copy them to siteDir before starting the timer
	if ( useBundled ) {
		const bundledPath = getBundledWordPressPath();
		if ( ! fs.existsSync( bundledPath ) ) {
			return { durationMs: 0, success: false, error: `Bundled WordPress not found at ${ bundledPath }. Run Studio app first.` };
		}
		copyDirSync( bundledPath, siteDir );
	}

	const start = performance.now();

	return new Promise( ( resolve ) => {
		let error: string | undefined;
		let resolved = false;

		const cleanup = async ( proc: ChildProcess ) => {
			try {
				if ( proc.pid ) {
					if ( process.platform === 'win32' ) {
						// On Windows, use taskkill to kill the process tree
						execSync( `taskkill /F /T /PID ${ proc.pid }`, { stdio: 'ignore' } );
					} else {
						// On Unix, kill the process group (negative PID)
						process.kill( -proc.pid, 'SIGTERM' );
					}
					// Give process time to exit gracefully
					await new Promise( ( r ) => setTimeout( r, 500 ) );
				}
			} catch {
				// Process may have already exited
			}
			// Also try to kill anything on the port
			await killProcessOnPort( port );
		};

		const args = [
			'server',
			`--port=${ port }`,
			'--wp=latest',
			'--php=8.2',
			// Use existing files if bundled, otherwise download
			`--wordpress-install-mode=${ useBundled ? 'install-from-existing-files' : 'download-and-install' }`,
		];

		// On Windows, use --mount-dir-before-install with separate args (paths contain colons)
		// On Unix, use --mount-before-install=host:vfs format
		if ( process.platform === 'win32' ) {
			args.push( '--mount-dir-before-install', siteDir, '/wordpress' );
		} else {
			args.push( `--mount-before-install=${ siteDir }:/wordpress` );
		}

		// Start the server with inherited stdio so we can see progress
		// Use detached: true to prevent signals from propagating to parent
		// On Windows, use shell: true for proper process handling
		const proc = spawn( PLAYGROUND_CLI_PATH, args, {
			stdio: 'inherit',
			env: { ...process.env, FORCE_COLOR: '1' },
			detached: process.platform !== 'win32',
			shell: process.platform === 'win32',
		} );

		// Keepalive to prevent event loop from exiting
		const keepalive = setInterval( () => {}, 1000 );

		proc.on( 'error', ( err ) => {
			clearInterval( keepalive );
			console.log( chalk.red( `Spawn error: ${ err.message }` ) );
			if ( ! resolved ) {
				resolved = true;
				resolve( { durationMs: performance.now() - start, success: false, error: `Spawn error: ${ err.message }` } );
			}
		} );

		proc.on( 'exit', ( code, signal ) => {
			clearInterval( keepalive );
			if ( ! resolved ) {
				resolved = true;
				resolve( { durationMs: performance.now() - start, success: false, error: error || `Process exited unexpectedly (code ${ code }, signal ${ signal })` } );
			}
		} );

		// Wait for the server to be ready
		waitForServer( port, 120000 ).then( async ( serverReady ) => {
			const durationMs = performance.now() - start;
			clearInterval( keepalive );

			// Set resolved BEFORE cleanup to prevent exit handler from resolving first
			if ( ! resolved ) {
				resolved = true;
				await cleanup( proc );

				if ( ! serverReady ) {
					resolve( { durationMs, success: false, error: error || 'Server failed to start within timeout' } );
				} else {
					resolve( { durationMs, success: true } );
				}
			}
		} ).catch( () => {
			clearInterval( keepalive );
		} );
	} );
}

/**
 * Benchmark Studio CLI site creation.
 */
async function benchmarkStudioCLI( siteDir: string, siteName: string ): Promise<{ durationMs: number; success: boolean; error?: string }> {
	// Studio CLI site create without --start (just creates the site)
	return runCommand( 'node', [ STUDIO_CLI_PATH, 'site', 'create', `--path=${ siteDir }`, `--name=${ siteName }`, '--start=false' ], {
		cwd: STUDIO_ROOT,
		timeout: 300000,
	} );
}

/**
 * Benchmark Studio CLI site creation with --start.
 */
async function benchmarkStudioCLIWithStart( siteDir: string, siteName: string ): Promise<{ durationMs: number; success: boolean; error?: string }> {
	const result = await runCommand(
		'node',
		[ STUDIO_CLI_PATH, 'site', 'create', `--path=${ siteDir }`, `--name=${ siteName }`, '--start=true', '--skip-browser' ],
		{
			cwd: STUDIO_ROOT,
			timeout: 300000,
		}
	);

	// Clean up: stop the site
	try {
		await runCommand( 'node', [ STUDIO_CLI_PATH, 'site', 'stop', `--path=${ siteDir }` ], {
			cwd: STUDIO_ROOT,
			timeout: 30000,
		} );
	} catch {
		// Ignore cleanup errors
	}

	return result;
}

async function runBenchmarkSuite(
	name: string,
	rounds: number,
	benchmarkFn: ( siteDir: string, extra: string ) => Promise<{ durationMs: number; success: boolean; error?: string }>,
	extraArg: string
): Promise<BenchmarkResult[]> {
	const results: BenchmarkResult[] = [];

	console.log( chalk.cyan( `\n  Running ${ name }...` ) );

	for ( let i = 1; i <= rounds; i++ ) {
		let siteDir: string;
		try {
			// Remove any special characters from temp dir name
			const safeName = name.toLowerCase().replace( /[^a-z0-9]+/g, '-' );
			siteDir = createTempDir( safeName );
		} catch ( err ) {
			console.error( chalk.red( `    Failed to create temp dir: ${ err }` ) );
			continue;
		}

		process.stdout.write( chalk.gray( `    Round ${ i }/${ rounds }: ` ) );

		let result: { durationMs: number; success: boolean; error?: string };
		try {
			result = await benchmarkFn( siteDir, extraArg );
		} catch ( err ) {
			console.log( chalk.red( `EXCEPTION: ${ err }` ) );
			result = { durationMs: 0, success: false, error: String( err ) };
		}

		results.push( {
			name,
			round: i,
			durationMs: result.durationMs,
			success: result.success,
			error: result.error,
		} );

		if ( result.success ) {
			console.log( chalk.green( `${ formatDuration( result.durationMs ) }` ) );
		} else {
			console.log( chalk.red( `FAILED: ${ result.error }` ) );
		}

		// Cleanup
		cleanupDir( siteDir );

		// Brief pause between rounds
		await new Promise( ( r ) => setTimeout( r, 1000 ) );
	}

	return results;
}

function calculateSummary( results: BenchmarkResult[] ): BenchmarkSummary {
	const successful = results.filter( ( r ) => r.success );
	const durations = successful.map( ( r ) => r.durationMs );

	return {
		name: results[ 0 ]?.name ?? 'Unknown',
		rounds: results.length,
		successful: successful.length,
		failed: results.length - successful.length,
		minMs: durations.length > 0 ? Math.min( ...durations ) : 0,
		maxMs: durations.length > 0 ? Math.max( ...durations ) : 0,
		avgMs: durations.length > 0 ? durations.reduce( ( a, b ) => a + b, 0 ) / durations.length : 0,
		medianMs: median( durations ),
	};
}

function printSummaryTable( summaries: BenchmarkSummary[] ): void {
	console.log( chalk.bold( '\n\nResults Summary' ) );
	console.log( '═'.repeat( 90 ) );

	const headers = [ 'Benchmark', 'Rounds', 'Success', 'Min', 'Max', 'Avg', 'Median' ];
	const widths = [ 35, 8, 9, 12, 12, 12, 12 ];

	console.log(
		headers.map( ( h, i ) => h.padEnd( widths[ i ] ) ).join( '' )
	);
	console.log( '─'.repeat( 90 ) );

	for ( const s of summaries ) {
		const row = [
			s.name.substring( 0, 34 ),
			`${ s.rounds }`,
			`${ s.successful }/${ s.rounds }`,
			formatDuration( s.minMs ),
			formatDuration( s.maxMs ),
			formatDuration( s.avgMs ),
			formatDuration( s.medianMs ),
		];
		console.log( row.map( ( c, i ) => c.padEnd( widths[ i ] ) ).join( '' ) );
	}

	console.log( '═'.repeat( 90 ) );

	// Print overhead comparison if we have both Playground and Studio results
	const playgroundResult = summaries.find( ( s ) => s.name.includes( 'Playground CLI' ) );
	const studioResult = summaries.find( ( s ) => s.name === 'Studio CLI (create only)' );
	const studioStartResult = summaries.find( ( s ) => s.name === 'Studio CLI (create + start)' );

	if ( playgroundResult && playgroundResult.medianMs > 0 ) {
		console.log( chalk.bold( '\nOverhead Analysis (vs Playground CLI baseline):' ) );

		if ( studioResult && studioResult.medianMs > 0 ) {
			const overheadMs = studioResult.medianMs - playgroundResult.medianMs;
			const overheadPct = ( ( studioResult.medianMs / playgroundResult.medianMs - 1 ) * 100 ).toFixed( 1 );
			console.log(
				`  Studio CLI (create only): ${ overheadMs > 0 ? '+' : '' }${ formatDuration( overheadMs ) } (${ overheadPct }%)`
			);
		}

		if ( studioStartResult && studioStartResult.medianMs > 0 ) {
			const overheadMs = studioStartResult.medianMs - playgroundResult.medianMs;
			const overheadPct = ( ( studioStartResult.medianMs / playgroundResult.medianMs - 1 ) * 100 ).toFixed( 1 );
			console.log(
				`  Studio CLI (create + start): ${ overheadMs > 0 ? '+' : '' }${ formatDuration( overheadMs ) } (${ overheadPct }%)`
			);
		}
	}
}

async function ensureStudioCLIBuilt(): Promise<boolean> {
	if ( ! fs.existsSync( STUDIO_CLI_PATH ) ) {
		console.log( chalk.yellow( '  Building Studio CLI...' ) );
		try {
			execSync( 'npm run cli:build', { cwd: STUDIO_ROOT, stdio: 'inherit' } );
			return true;
		} catch ( err ) {
			console.error( chalk.red( '  Failed to build Studio CLI' ) );
			return false;
		}
	}
	return true;
}

async function ensurePlaygroundCLIInstalled(): Promise<boolean> {
	if ( ! fs.existsSync( PLAYGROUND_CLI_PATH ) ) {
		console.log( chalk.yellow( '  Installing dependencies (including @wp-playground/cli)...' ) );
		try {
			execSync( 'npm install', { cwd: import.meta.dirname, stdio: 'inherit' } );
			return true;
		} catch ( err ) {
			console.error( chalk.red( '  Failed to install Playground CLI' ) );
			return false;
		}
	}
	return true;
}

async function main() {
	const { rounds, skipPlayground, skipStudio, useBundled } = parseArgs();

	console.log( chalk.bold.cyan( '\n=== Studio Site Create Benchmark ===' ) );
	console.log( chalk.gray( `Platform: ${ os.platform() } ${ os.arch() }` ) );
	console.log( chalk.gray( `Node: ${ process.version }` ) );
	console.log( chalk.gray( `Rounds: ${ rounds }` ) );
	console.log( chalk.gray( `Use bundled: ${ useBundled }` ) );
	console.log( chalk.gray( `Date: ${ new Date().toISOString() }` ) );

	// Setup
	console.log( chalk.bold( '\nSetup:' ) );

	if ( ! skipPlayground ) {
		if ( ! ( await ensurePlaygroundCLIInstalled() ) ) {
			process.exit( 1 );
		}
		console.log( chalk.green( '  Playground CLI ready' ) );

		if ( useBundled ) {
			const bundledPath = getBundledWordPressPath();
			if ( ! fs.existsSync( bundledPath ) ) {
				console.error( chalk.red( `  Bundled WordPress not found at: ${ bundledPath }` ) );
				console.error( chalk.red( '  Please run the Studio app first to download WordPress files.' ) );
				process.exit( 1 );
			}
			console.log( chalk.green( '  Bundled WordPress files found' ) );
		}
	}

	if ( ! skipStudio ) {
		if ( ! ( await ensureStudioCLIBuilt() ) ) {
			process.exit( 1 );
		}
		console.log( chalk.green( '  Studio CLI ready' ) );
	}

	const allResults: BenchmarkResult[] = [];
	const port = 9876; // Use a fixed port for Playground benchmarks

	// Run benchmarks
	console.log( chalk.bold( '\nBenchmarks:' ) );

	// 1. Raw Playground CLI
	if ( ! skipPlayground ) {
		try {
			await killProcessOnPort( port );
			const benchmarkName = useBundled
				? 'Playground CLI (bundled files)'
				: 'Playground CLI (download)';
			const results = await runBenchmarkSuite(
				benchmarkName,
				rounds,
				( siteDir ) => benchmarkPlaygroundCLI( siteDir, port, useBundled ),
				String( port )
			);
			allResults.push( ...results );
		} catch ( err ) {
			console.error( chalk.red( `\n  Playground benchmark failed: ${ err }` ) );
		}
	}

	// 2. Studio CLI (create only, no start)
	if ( ! skipStudio ) {
		const results = await runBenchmarkSuite(
			'Studio CLI (create only)',
			rounds,
			( siteDir, name ) => benchmarkStudioCLI( siteDir, name ),
			`benchmark-site-${ Date.now() }`
		);
		allResults.push( ...results );
	}

	// 3. Studio CLI (create + start)
	if ( ! skipStudio ) {
		const results = await runBenchmarkSuite(
			'Studio CLI (create + start)',
			rounds,
			( siteDir, name ) => benchmarkStudioCLIWithStart( siteDir, name ),
			`benchmark-site-${ Date.now() }`
		);
		allResults.push( ...results );
	}

	// Calculate and display summaries
	const summaries: BenchmarkSummary[] = [];
	const benchmarkNames = [ ...new Set( allResults.map( ( r ) => r.name ) ) ];

	for ( const name of benchmarkNames ) {
		const results = allResults.filter( ( r ) => r.name === name );
		summaries.push( calculateSummary( results ) );
	}

	printSummaryTable( summaries );

	// Save results to JSON
	const outputPath = path.join( import.meta.dirname, `results-${ os.platform() }-${ Date.now() }.json` );
	const output = {
		platform: os.platform(),
		arch: os.arch(),
		nodeVersion: process.version,
		date: new Date().toISOString(),
		rounds,
		results: allResults,
		summaries,
	};

	fs.writeFileSync( outputPath, JSON.stringify( output, null, 2 ) );
	console.log( chalk.gray( `\nResults saved to: ${ outputPath }` ) );
}

main().catch( ( err ) => {
	console.error( chalk.red( 'Benchmark failed:' ), err );
	process.exit( 1 );
} );
