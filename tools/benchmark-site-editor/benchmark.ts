#!/usr/bin/env ts-node

/**
 * Site Editor Performance Benchmark — Orchestration Script
 *
 * Benchmarks site editor performance across a matrix of environments:
 *   - Studio (bare, multi-worker, plugins, multi-worker+plugins)
 *   - Playground CLI (bare, multi-worker, plugins, multi-worker+plugins)
 *   - Playground Web (bare, plugins)
 *   - Custom (any running WordPress site via --custom-url)
 *
 * Usage:
 *   cd tools/benchmark-site-editor
 *   npm install
 *   npm run benchmark
 *
 * Options:
 *   --rounds=N              Number of benchmark runs per environment (default: 1)
 *   --skip-studio           Skip Studio environments
 *   --skip-playground-cli   Skip Playground CLI environments
 *   --skip-playground-web   Skip Playground web environments
 *   --custom=<name>,<url>[,<user>,<password>]  Add a custom WordPress site (repeatable)
 *   --install-plugins[=<name1>,<name2>]        Install plugins from blueprint via WP REST API
 *   --only=<env1,env2>      Run only these environments (comma-separated)
 *   --help                  Show help
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { installPlugins } from './install-plugins.ts';
import { measureSiteEditor, METRIC_NAMES, type MeasurementResult } from './measure-site-editor.ts';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const STUDIO_ROOT = path.resolve( import.meta.dirname, '../..' );
const STUDIO_CLI_PATH = path.resolve( STUDIO_ROOT, 'apps/cli/dist/cli/main.mjs' );
const PLAYGROUND_CLI_BIN =
	process.platform === 'win32' ? 'wp-playground-cli.cmd' : 'wp-playground-cli';
const PLAYGROUND_CLI_PATH = path.resolve(
	import.meta.dirname,
	'node_modules/.bin',
	PLAYGROUND_CLI_BIN
);
const PLUGINS_BLUEPRINT_PATH = path.resolve( import.meta.dirname, 'plugins-blueprint.json' );
const ARTIFACTS_PATH = path.resolve( STUDIO_ROOT, 'metrics', 'artifacts' );

const PLAYGROUND_WEB_BASE_URL = 'https://playground.wordpress.net';

// Port offset for Playground CLI servers — avoids collisions with dev servers
const PLAYGROUND_CLI_PORT_BASE = 9500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EnvironmentType = 'studio' | 'playground-cli' | 'playground-web' | 'custom';

interface EnvironmentConfig {
	name: string;
	type: EnvironmentType;
	plugins: boolean;
	multiWorker: boolean;
	/** Base URL for custom environments. */
	customUrl?: string;
	/** WordPress admin credentials for custom environments. */
	credentials?: { username: string; password: string };
}

interface BenchmarkResult {
	environment: string;
	metrics: Record< string, number >;
}

// ---------------------------------------------------------------------------
// Environment matrix
// ---------------------------------------------------------------------------

const ALL_ENVIRONMENTS: EnvironmentConfig[] = [
	{ name: 'studio', type: 'studio', plugins: false, multiWorker: false },
	{ name: 'studio-mw', type: 'studio', plugins: false, multiWorker: true },
	{ name: 'studio-plugins', type: 'studio', plugins: true, multiWorker: false },
	{ name: 'studio-mw-plugins', type: 'studio', plugins: true, multiWorker: true },
	{ name: 'pg-cli', type: 'playground-cli', plugins: false, multiWorker: false },
	{ name: 'pg-cli-mw', type: 'playground-cli', plugins: false, multiWorker: true },
	{ name: 'pg-cli-plugins', type: 'playground-cli', plugins: true, multiWorker: false },
	{
		name: 'pg-cli-mw-plugins',
		type: 'playground-cli',
		plugins: true,
		multiWorker: true,
	},
	{ name: 'pg-web', type: 'playground-web', plugins: false, multiWorker: false },
	{ name: 'pg-web-plugins', type: 'playground-web', plugins: true, multiWorker: false },
];

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface CustomEnvInput {
	name: string;
	url: string;
	user: string;
	password: string;
}

interface Options {
	rounds: number;
	skipStudio: boolean;
	skipPlaygroundCli: boolean;
	skipPlaygroundWeb: boolean;
	only: string[];
	headed: boolean;
	customs: CustomEnvInput[];
	/** Names of custom environments to install plugins on, or 'all'. */
	installPlugins: string[] | 'all' | false;
}

function parseCustomFlag( value: string ): CustomEnvInput {
	const parts = value.split( ',' );
	if ( parts.length < 2 ) {
		throw new Error(
			`Invalid --custom value: "${ value }"\nExpected: --custom=name,url[,user,password]`
		);
	}
	return {
		name: parts[ 0 ],
		url: parts[ 1 ],
		user: parts[ 2 ] || 'admin',
		password: parts[ 3 ] || 'password',
	};
}

function parseArgs(): Options {
	const argv = yargs( hideBin( process.argv ) )
		.usage( 'Usage: npm run benchmark [options]' )
		.option( 'rounds', {
			type: 'number',
			default: 1,
			describe: 'Number of benchmark runs per environment',
		} )
		.option( 'skip-studio', {
			type: 'boolean',
			default: false,
			describe: 'Skip Studio environments',
		} )
		.option( 'skip-playground-cli', {
			type: 'boolean',
			default: false,
			describe: 'Skip Playground CLI environments',
		} )
		.option( 'skip-playground-web', {
			type: 'boolean',
			default: false,
			describe: 'Skip Playground web environments',
		} )
		.option( 'custom', {
			type: 'string',
			array: true,
			default: [] as string[],
			describe: 'Add a custom WordPress site: name,url[,user,password] (repeatable)',
		} )
		.option( 'install-plugins', {
			type: 'string',
			describe:
				'Install blueprint plugins on custom environments. Pass without value for all, or comma-separated names.',
		} )
		.option( 'only', {
			type: 'string',
			describe: 'Run only named environments (comma-separated)',
		} )
		.option( 'headed', {
			type: 'boolean',
			default: false,
			describe: 'Launch browser in headed mode for debugging',
		} )
		.example( [
			[
				'npm run benchmark -- --custom=my-site,http://localhost:10003',
				'Benchmark a single custom WordPress site',
			],
			[
				'npm run benchmark -- --custom=bare,http://localhost:10003 --custom=plugins,http://localhost:10004 --install-plugins=plugins',
				'Two custom sites: bare vs with plugins',
			],
			[
				'npm run benchmark -- --custom=my-site,http://localhost:10003,admin,secret',
				'Custom site with non-default credentials',
			],
			[
				'npm run benchmark -- --only=studio,my-site --custom=my-site,http://localhost:10003 --rounds=3',
				'Compare Studio vs a custom site',
			],
		] )
		.epilog( `Built-in environments: ${ ALL_ENVIRONMENTS.map( ( e ) => e.name ).join( ', ' ) }` )
		.strict()
		.parseSync();

	// Parse --install-plugins: boolean true means "all", string means specific names
	let installPluginsOpt: Options[ 'installPlugins' ] = false;
	if ( argv[ 'install-plugins' ] !== undefined ) {
		const val = argv[ 'install-plugins' ];
		if ( val === '' || val === 'true' ) {
			installPluginsOpt = 'all';
		} else {
			installPluginsOpt = val.split( ',' ).map( ( s: string ) => s.trim() );
		}
	}

	return {
		rounds: argv.rounds,
		skipStudio: argv[ 'skip-studio' ],
		skipPlaygroundCli: argv[ 'skip-playground-cli' ],
		skipPlaygroundWeb: argv[ 'skip-playground-web' ],
		only: argv.only ? argv.only.split( ',' ).map( ( s: string ) => s.trim() ) : [],
		headed: argv.headed,
		customs: ( argv.custom as string[] ).map( parseCustomFlag ),
		installPlugins: installPluginsOpt,
	};
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

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

async function waitForServer( url: string, timeoutMs = 60_000 ): Promise< boolean > {
	const start = Date.now();
	while ( Date.now() - start < timeoutMs ) {
		try {
			const response = await fetch( url );
			if ( response.ok || response.status === 302 || response.status === 301 ) {
				return true;
			}
		} catch {
			// Server not ready yet
		}
		await sleep( 1000 );
	}
	return false;
}

async function killProcessOnPort( port: number ): Promise< void > {
	return new Promise( ( resolve ) => {
		try {
			if ( process.platform === 'win32' ) {
				execSync(
					`for /f "tokens=5" %a in ('netstat -aon ^| find ":${ port }"') do taskkill /F /PID %a`,
					{ stdio: 'ignore' }
				);
			} else {
				execSync( `lsof -ti:${ port } | xargs kill -9 2>/dev/null || true`, {
					stdio: 'ignore',
				} );
			}
		} catch {
			// Process may not exist
		}
		setTimeout( resolve, 500 );
	} );
}

function sleep( ms: number ): Promise< void > {
	return new Promise( ( resolve ) => setTimeout( resolve, ms ) );
}

function runCommand(
	command: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}
): Promise< { stdout: string; stderr: string; exitCode: number } > {
	const timeout = options.timeout ?? 300_000;

	return new Promise( ( resolve ) => {
		let stdout = '';
		let stderr = '';
		let timedOut = false;

		const proc = spawn( command, args, {
			cwd: options.cwd,
			stdio: [ 'ignore', 'pipe', 'pipe' ],
			env: { ...process.env, ...options.env, FORCE_COLOR: '0' },
		} );

		const timeoutId = setTimeout( () => {
			timedOut = true;
			proc.kill( 'SIGKILL' );
		}, timeout );

		proc.stdout?.on( 'data', ( data ) => {
			stdout += data.toString();
		} );
		proc.stderr?.on( 'data', ( data ) => {
			stderr += data.toString();
		} );

		proc.on( 'close', ( code ) => {
			clearTimeout( timeoutId );
			if ( timedOut ) {
				resolve( { stdout, stderr: 'Timeout', exitCode: 1 } );
			} else {
				resolve( { stdout, stderr, exitCode: code ?? 1 } );
			}
		} );

		proc.on( 'error', ( err ) => {
			clearTimeout( timeoutId );
			resolve( { stdout, stderr: err.message, exitCode: 1 } );
		} );
	} );
}

// ---------------------------------------------------------------------------
// Studio environment helpers
// ---------------------------------------------------------------------------

function createStudioAppdata( appdataDir: string, multiWorker: boolean ): void {
	const studioDir = path.join( appdataDir, 'Studio' );
	fs.mkdirSync( studioDir, { recursive: true } );

	const appdata = {
		version: 1,
		sites: [],
		snapshots: [],
		betaFeatures: {
			studioSitesCli: true,
			multiWorkerSupport: multiWorker,
		},
	};

	fs.writeFileSync( path.join( studioDir, 'appdata-v1.json' ), JSON.stringify( appdata, null, 2 ) );

	// Set up server-files with symlinks to the repo's bundled wp-files.
	// The CLI expects these at <appdataDir>/Studio/server-files/.
	const serverFilesDir = path.join( studioDir, 'server-files' );
	const wpFilesDir = path.join( STUDIO_ROOT, 'wp-files' );

	fs.mkdirSync( path.join( serverFilesDir, 'wordpress-versions' ), { recursive: true } );
	fs.symlinkSync(
		path.join( wpFilesDir, 'latest', 'wordpress' ),
		path.join( serverFilesDir, 'wordpress-versions', 'latest' )
	);
	fs.symlinkSync(
		path.join( wpFilesDir, 'sqlite-database-integration' ),
		path.join( serverFilesDir, 'sqlite-database-integration' )
	);
	fs.symlinkSync(
		path.join( wpFilesDir, 'sqlite-command' ),
		path.join( serverFilesDir, 'sqlite-command' )
	);
	fs.symlinkSync(
		path.join( wpFilesDir, 'wp-cli', 'wp-cli.phar' ),
		path.join( serverFilesDir, 'wp-cli.phar' )
	);
}

function getStudioCliEnv( appdataDir: string ): NodeJS.ProcessEnv {
	return {
		E2E: 'true',
		E2E_APP_DATA_PATH: appdataDir,
	};
}

async function setupStudioSite(
	env: EnvironmentConfig
): Promise< { url: string; siteDir: string; appdataDir: string } > {
	const siteDir = createTempDir( env.name );
	const appdataDir = createTempDir( `${ env.name }-appdata` );
	const siteName = `bench-${ env.name }`;

	createStudioAppdata( appdataDir, env.multiWorker );

	const cliEnv = getStudioCliEnv( appdataDir );

	// Build the create args
	const createArgs = [
		STUDIO_CLI_PATH,
		'site',
		'create',
		`--path=${ siteDir }`,
		`--name=${ siteName }`,
		'--start=true',
		'--skip-browser',
	];

	if ( env.plugins ) {
		createArgs.push( `--blueprint=${ PLUGINS_BLUEPRINT_PATH }` );
	}

	console.log( chalk.gray( `    Creating Studio site at ${ siteDir }` ) );
	const result = await runCommand( 'node', createArgs, {
		cwd: STUDIO_ROOT,
		env: cliEnv,
		timeout: 600_000, // 10 min for site creation with plugins
	} );

	if ( result.exitCode !== 0 ) {
		// The Studio CLI logs errors to stdout via its Logger, so show both
		const errorOutput = ( result.stdout + '\n' + result.stderr ).trim();
		console.error( chalk.red( `    Studio site creation failed:\n${ errorOutput }` ) );
		throw new Error( `Studio site creation failed` );
	}

	// Extract the URL from the appdata (site was created and started)
	const appdataPath = path.join( appdataDir, 'Studio', 'appdata-v1.json' );
	const appdata = JSON.parse( fs.readFileSync( appdataPath, 'utf-8' ) );
	const site = appdata.sites?.[ 0 ];
	if ( ! site?.port ) {
		throw new Error( 'Studio site was created but no port was assigned' );
	}
	const url = site.url || `http://localhost:${ site.port }`;

	console.log( chalk.gray( `    Studio site running at ${ url }` ) );
	return { url, siteDir, appdataDir };
}

async function teardownStudioSite( siteDir: string, appdataDir: string ): Promise< void > {
	const cliEnv = getStudioCliEnv( appdataDir );

	// Stop the site
	await runCommand( 'node', [ STUDIO_CLI_PATH, 'site', 'stop', `--path=${ siteDir }` ], {
		cwd: STUDIO_ROOT,
		env: cliEnv,
		timeout: 30_000,
	} ).catch( () => {} );

	// Delete the site from appdata
	await runCommand( 'node', [ STUDIO_CLI_PATH, 'site', 'delete', `--path=${ siteDir }` ], {
		cwd: STUDIO_ROOT,
		env: cliEnv,
		timeout: 30_000,
	} ).catch( () => {} );

	// Clean up temp dirs
	cleanupDir( siteDir );
	cleanupDir( appdataDir );
}

// ---------------------------------------------------------------------------
// Playground CLI environment helpers
// ---------------------------------------------------------------------------

async function setupPlaygroundCliSite(
	env: EnvironmentConfig,
	port: number
): Promise< { url: string; process: ChildProcess; siteDir: string } > {
	const siteDir = createTempDir( env.name );

	await killProcessOnPort( port );

	const args = [ 'server', `--port=${ port }`, '--wp=latest', '--php=8.2' ];

	// Mount the site dir
	if ( process.platform === 'win32' ) {
		args.push( '--mount-dir-before-install', siteDir, '/wordpress' );
	} else {
		args.push( `--mount-before-install=${ siteDir }:/wordpress` );
	}

	if ( env.plugins ) {
		args.push( `--blueprint=${ PLUGINS_BLUEPRINT_PATH }` );
	}

	if ( env.multiWorker ) {
		const workerCount = Math.max( 1, os.cpus().length - 1 );
		args.push( `--experimental-multi-worker=${ workerCount }` );
	}

	console.log( chalk.gray( `    Starting Playground CLI on port ${ port }` ) );

	const proc = spawn( PLAYGROUND_CLI_PATH, args, {
		stdio: [ 'ignore', 'pipe', 'pipe' ],
		env: { ...process.env, FORCE_COLOR: '0' },
		detached: process.platform !== 'win32',
		shell: process.platform === 'win32',
	} );

	// Log stderr output for debugging if the server fails to start
	let pgStderr = '';
	proc.stderr?.on( 'data', ( data ) => {
		pgStderr += data.toString();
	} );

	const url = `http://127.0.0.1:${ port }`;

	// Wait for server to be ready
	const ready = await waitForServer( url, 180_000 );
	if ( ! ready ) {
		proc.kill( 'SIGKILL' );
		if ( pgStderr ) {
			console.error( chalk.gray( pgStderr.slice( 0, 500 ) ) );
		}
		throw new Error( `Playground CLI server failed to start on port ${ port }` );
	}

	console.log( chalk.gray( `    Playground CLI running at ${ url }` ) );
	return { url, process: proc, siteDir };
}

async function teardownPlaygroundCliSite(
	proc: ChildProcess,
	port: number,
	siteDir: string
): Promise< void > {
	try {
		if ( proc.pid ) {
			if ( process.platform === 'win32' ) {
				execSync( `taskkill /F /T /PID ${ proc.pid }`, { stdio: 'ignore' } );
			} else {
				process.kill( -proc.pid, 'SIGTERM' );
			}
		}
	} catch {
		// Process may have already exited
	}
	await killProcessOnPort( port );
	await sleep( 1000 );
	cleanupDir( siteDir );
}

// ---------------------------------------------------------------------------
// Playground Web environment helpers
// ---------------------------------------------------------------------------

function getPlaygroundWebUrl( env: EnvironmentConfig ): string {
	if ( ! env.plugins ) {
		return PLAYGROUND_WEB_BASE_URL;
	}

	// Pass the blueprint as a JSON fragment in the URL hash
	const blueprint = JSON.parse( fs.readFileSync( PLUGINS_BLUEPRINT_PATH, 'utf-8' ) );
	return `${ PLAYGROUND_WEB_BASE_URL }/#${ JSON.stringify( blueprint ) }`;
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

const MEASUREMENT_TIMEOUT = 600_000; // 10 min per measurement

async function runBenchmark(
	benchmarkUrl: string,
	env: EnvironmentConfig,
	rounds: number,
	headed: boolean
): Promise< Record< string, number > | null > {
	console.log(
		chalk.gray( `    Running benchmark (${ rounds } round${ rounds > 1 ? 's' : '' })...` )
	);

	const parsedBenchmarkUrl = new URL( benchmarkUrl );
	const isPlaygroundWeb = parsedBenchmarkUrl.hostname === 'playground.wordpress.net';
	const isPlaygroundCli = parsedBenchmarkUrl.hostname === '127.0.0.1';
	const allMeasurements: MeasurementResult[] = [];

	for ( let round = 1; round <= rounds; round++ ) {
		if ( rounds > 1 ) {
			console.log( chalk.gray( `      Round ${ round }/${ rounds }...` ) );
		}
		try {
			const result = await Promise.race( [
				measureSiteEditor( {
					url: benchmarkUrl,
					isPlaygroundWeb,
					isPlaygroundCli,
					credentials: env.credentials,
					headed,
				} ),
				sleep( MEASUREMENT_TIMEOUT ).then( () => {
					throw new Error( 'Measurement timed out' );
				} ),
			] );
			allMeasurements.push( result );
		} catch ( err ) {
			console.warn( chalk.yellow( `      Round ${ round } failed: ${ err }` ) );
		}

		// Small delay between rounds
		if ( round < rounds ) {
			await sleep( 1000 );
		}
	}

	if ( allMeasurements.length === 0 ) {
		return null;
	}

	// Calculate medians across rounds
	const medians: Record< string, number > = {};
	for ( const metric of METRIC_NAMES ) {
		const values = allMeasurements
			.map( ( m ) => m[ metric ] )
			.filter( ( v ): v is number => v !== undefined );
		if ( values.length > 0 ) {
			medians[ metric ] = median( values );
		}
	}

	return medians;
}

// ---------------------------------------------------------------------------
// Results formatting
// ---------------------------------------------------------------------------

function printComparisonTable( results: BenchmarkResult[] ): void {
	if ( results.length === 0 ) {
		console.log( chalk.yellow( '\nNo results to display.' ) );
		return;
	}

	// Collect all unique metric names across all results
	const allMetrics = new Set< string >();
	for ( const r of results ) {
		Object.keys( r.metrics ).forEach( ( k ) => allMetrics.add( k ) );
	}
	const metrics = [ ...allMetrics ].sort();

	// Calculate column widths
	const metricColWidth = Math.max( 20, ...metrics.map( ( m ) => m.length + 2 ) );
	const envColWidth = Math.max( 12, ...results.map( ( r ) => r.environment.length + 2 ) );

	// Header
	console.log( chalk.bold( '\n\nResults Comparison' ) );
	console.log( '═'.repeat( metricColWidth + envColWidth * results.length ) );

	const header =
		'Metric'.padEnd( metricColWidth ) +
		results.map( ( r ) => r.environment.padEnd( envColWidth ) ).join( '' );
	console.log( chalk.bold( header ) );
	console.log( '─'.repeat( metricColWidth + envColWidth * results.length ) );

	// Rows
	for ( const metric of metrics ) {
		let row = metric.padEnd( metricColWidth );

		for ( const r of results ) {
			const value = r.metrics[ metric ];
			if ( value !== undefined ) {
				row += formatDuration( value ).padEnd( envColWidth );
			} else {
				row += '—'.padEnd( envColWidth );
			}
		}

		console.log( row );
	}

	console.log( '═'.repeat( metricColWidth + envColWidth * results.length ) );
}

function saveResultsSummary( results: BenchmarkResult[] ): void {
	const summaryPath = path.join( ARTIFACTS_PATH, `benchmark-comparison-${ Date.now() }.json` );
	const summary = {
		date: new Date().toISOString(),
		platform: os.platform(),
		arch: os.arch(),
		nodeVersion: process.version,
		cpus: os.cpus().length,
		results,
	};
	fs.mkdirSync( ARTIFACTS_PATH, { recursive: true } );
	fs.writeFileSync( summaryPath, JSON.stringify( summary, null, 2 ) );
	console.log( chalk.gray( `\nResults saved to: ${ summaryPath }` ) );
}

// ---------------------------------------------------------------------------
// Setup checks
// ---------------------------------------------------------------------------

async function ensureStudioCLIBuilt(): Promise< boolean > {
	if ( ! fs.existsSync( STUDIO_CLI_PATH ) ) {
		console.log( chalk.yellow( '  Building Studio CLI...' ) );
		try {
			execSync( 'npm run cli:build', { cwd: STUDIO_ROOT, stdio: 'inherit' } );
			return true;
		} catch {
			console.error( chalk.red( '  Failed to build Studio CLI' ) );
			return false;
		}
	}
	return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const opts = parseArgs();

	// Filter environments
	let environments = [ ...ALL_ENVIRONMENTS ];

	// Add custom environments from --custom flags
	for ( const custom of opts.customs ) {
		const shouldInstallPlugins =
			opts.installPlugins === 'all' ||
			( Array.isArray( opts.installPlugins ) && opts.installPlugins.includes( custom.name ) );

		environments.push( {
			name: custom.name,
			type: 'custom',
			plugins: shouldInstallPlugins,
			multiWorker: false,
			customUrl: custom.url,
			credentials: { username: custom.user, password: custom.password },
		} );
	}

	if ( opts.only.length > 0 ) {
		environments = environments.filter( ( e ) => opts.only.includes( e.name ) );
	} else {
		if ( opts.skipStudio ) {
			environments = environments.filter( ( e ) => e.type !== 'studio' );
		}
		if ( opts.skipPlaygroundCli ) {
			environments = environments.filter( ( e ) => e.type !== 'playground-cli' );
		}
		if ( opts.skipPlaygroundWeb ) {
			environments = environments.filter( ( e ) => e.type !== 'playground-web' );
		}
	}

	if ( environments.length === 0 ) {
		console.log( chalk.yellow( 'No environments selected. Nothing to do.' ) );
		return;
	}

	console.log( chalk.bold.cyan( '\n=== Site Editor Performance Benchmark ===' ) );
	console.log( chalk.gray( `Platform: ${ os.platform() } ${ os.arch() }` ) );
	console.log( chalk.gray( `Node: ${ process.version }` ) );
	console.log( chalk.gray( `CPUs: ${ os.cpus().length }` ) );
	console.log( chalk.gray( `Rounds: ${ opts.rounds }` ) );
	console.log( chalk.gray( `Date: ${ new Date().toISOString() }` ) );
	console.log(
		chalk.gray( `Environments: ${ environments.map( ( e ) => e.name ).join( ', ' ) }` )
	);

	// Setup
	console.log( chalk.bold( '\nSetup:' ) );

	// Ensure Playwright browsers are installed
	try {
		execSync( 'npx playwright install chromium', { cwd: import.meta.dirname, stdio: 'ignore' } );
		console.log( chalk.green( '  Playwright chromium ready' ) );
	} catch {
		console.error( chalk.red( '  Failed to install Playwright chromium' ) );
		process.exit( 1 );
	}

	const needsStudio = environments.some( ( e ) => e.type === 'studio' );

	if ( needsStudio ) {
		if ( ! ( await ensureStudioCLIBuilt() ) ) {
			process.exit( 1 );
		}
		console.log( chalk.green( '  Studio CLI ready' ) );
	}

	fs.mkdirSync( ARTIFACTS_PATH, { recursive: true } );

	// Run benchmarks
	const allResults: BenchmarkResult[] = [];
	let playgroundCliPortOffset = 0;

	for ( const env of environments ) {
		console.log( chalk.bold.cyan( `\n  ▶ ${ env.name }` ) );
		const tags = [ env.plugins ? 'plugins' : null, env.multiWorker ? 'multi-worker' : null ]
			.filter( Boolean )
			.join( ', ' );
		if ( tags ) {
			console.log( chalk.gray( `    (${ tags })` ) );
		}

		let benchmarkUrl: string;
		let teardownFn: ( () => Promise< void > ) | null = null;

		try {
			// Setup environment
			if ( env.type === 'studio' ) {
				const setup = await setupStudioSite( env );
				benchmarkUrl = setup.url;
				teardownFn = () => teardownStudioSite( setup.siteDir, setup.appdataDir );
			} else if ( env.type === 'playground-cli' ) {
				const port = PLAYGROUND_CLI_PORT_BASE + playgroundCliPortOffset++;
				const setup = await setupPlaygroundCliSite( env, port );
				benchmarkUrl = setup.url;
				teardownFn = () => teardownPlaygroundCliSite( setup.process, port, setup.siteDir );
			} else if ( env.type === 'custom' ) {
				benchmarkUrl = env.customUrl!;
				console.log( chalk.gray( `    URL: ${ benchmarkUrl }` ) );

				if ( env.plugins && env.credentials ) {
					console.log( chalk.gray( `    Installing plugins via REST API...` ) );
					try {
						await installPlugins(
							benchmarkUrl,
							PLUGINS_BLUEPRINT_PATH,
							env.credentials.username,
							env.credentials.password
						);
					} catch ( err ) {
						console.warn( chalk.yellow( `    Plugin installation failed: ${ err }` ) );
					}
				}
			} else {
				benchmarkUrl = getPlaygroundWebUrl( env );
				console.log( chalk.gray( `    URL: ${ benchmarkUrl.slice( 0, 80 ) }...` ) );
			}

			// Run benchmark
			const metrics = await runBenchmark( benchmarkUrl, env, opts.rounds, opts.headed );

			if ( metrics ) {
				allResults.push( { environment: env.name, metrics } );
				console.log( chalk.green( `    ✓ Done` ) );
			} else {
				console.log( chalk.red( `    ✗ Failed` ) );
			}
		} catch ( err ) {
			console.error( chalk.red( `    ✗ Error: ${ err }` ) );
		} finally {
			// Teardown
			if ( teardownFn ) {
				console.log( chalk.gray( '    Cleaning up...' ) );
				await teardownFn().catch( () => {} );
			}
		}
	}

	// Print results
	printComparisonTable( allResults );
	saveResultsSummary( allResults );

	process.exit( 0 );
}

main().catch( ( err ) => {
	console.error( chalk.red( 'Benchmark failed:' ), err );
	process.exit( 1 );
} );
