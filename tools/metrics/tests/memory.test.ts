import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import readline from 'readline';
import { test } from '@playwright/test';
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';
import { E2ESession } from '../../../apps/studio/e2e/e2e-helpers';
import AddSite from '../../../apps/studio/e2e/page-objects/add-site';
import Sidebar from '../../../apps/studio/e2e/page-objects/sidebar';
import { median } from '../utils';

const SCREENSHOTS = 3;
const SAMPLE_INTERVAL_MS = 250;
const SETTLE_MS = 5000;
const IDLE_SAMPLES = 5;
const TOOL_TIMEOUT_MS = 120_000;
const SITE_TIMEOUT_MS = 180_000;
const BROWSER_INSTALL_TIMEOUT_MS = 10 * 60_000;
const BYTES_PER_MB = 1_048_576;

type ToolResult = { isError?: boolean; content?: Array< { type: string; text?: string } > };

// The part of MCP's stdio transport this test needs: one JSON message per line.
class McpClient {
	private nextId = 1;
	private pending = new Map<
		number,
		{ resolve: ( value: unknown ) => void; reject: ( error: Error ) => void }
	>();
	private stderr = '';

	constructor( private server: ChildProcessWithoutNullStreams ) {
		readline.createInterface( { input: server.stdout } ).on( 'line', ( line ) => {
			let message: { id?: number; result?: unknown; error?: { message?: string } };
			try {
				message = JSON.parse( line );
			} catch {
				return;
			}
			const request = message.id === undefined ? undefined : this.pending.get( message.id );
			if ( ! request || ! ( 'result' in message || 'error' in message ) ) {
				return;
			}
			this.pending.delete( message.id as number );
			if ( message.error ) {
				request.reject( new Error( message.error.message ?? 'MCP request failed' ) );
			} else {
				request.resolve( message.result );
			}
		} );
		server.stderr.on( 'data', ( chunk ) => {
			this.stderr = ( this.stderr + chunk ).slice( -4000 );
		} );
		server.on( 'exit', ( code ) => {
			for ( const request of this.pending.values() ) {
				request.reject( new Error( `studio mcp exited with code ${ code }: ${ this.stderr }` ) );
			}
			this.pending.clear();
		} );
	}

	private send( message: Record< string, unknown > ) {
		this.server.stdin.write( `${ JSON.stringify( { jsonrpc: '2.0', ...message } ) }\n` );
	}

	request< T >( method: string, params: Record< string, unknown >, timeoutMs: number ) {
		const id = this.nextId++;
		return new Promise< T >( ( resolve, reject ) => {
			const timer = setTimeout( () => {
				this.pending.delete( id );
				reject( new Error( `${ method } got no answer in ${ timeoutMs } ms: ${ this.stderr }` ) );
			}, timeoutMs );
			this.pending.set( id, {
				resolve: ( value ) => {
					clearTimeout( timer );
					resolve( value as T );
				},
				reject: ( error ) => {
					clearTimeout( timer );
					reject( error );
				},
			} );
			this.send( { id, method, params } );
		} );
	}

	async initialize() {
		await this.request(
			'initialize',
			{
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'studio-metrics', version: '1.0.0' },
			},
			60_000
		);
		this.send( { method: 'notifications/initialized' } );
	}

	callTool( name: string, args: Record< string, unknown > ) {
		return this.request< ToolResult >( 'tools/call', { name, arguments: args }, TOOL_TIMEOUT_MS );
	}
}

type Usage = { total: number; parts: Record< string, number > };

function partOf( command: string, fromPackage: boolean ): string {
	// A site is its PHP processes and the CLI process that runs them.
	if ( /\/php( |$)|\/cli\/php-/.test( command ) ) {
		return 'sites';
	}
	if ( ! fromPackage ) {
		return /ms-playwright|chrom|headless[_-]shell/i.test( command ) ? 'browser' : 'other';
	}
	return /\/bin\/node( |$)/.test( command ) ? 'cli' : 'app';
}

/**
 * The resident memory, in bytes, of every process Studio runs: the ones started from the
 * packaged app (some outlive the process that started them, so they are found by their path),
 * `rootPids`, and everything those started. Processes share pages, so the sum counts some
 * memory more than once: it follows Studio's real use, and is higher than it.
 */
function studioMemory( packagePaths: string[], rootPids: number[] ): Usage {
	const processes = execFileSync( 'ps', [ '-axo', 'pid=,ppid=,rss=,args=' ], {
		maxBuffer: 64 * BYTES_PER_MB,
	} )
		.toString()
		.split( '\n' )
		.map( ( line ) => line.trim().match( /^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/ ) )
		.filter( ( match ): match is RegExpMatchArray => match !== null )
		.map( ( [ , pid, parent, rss, command ] ) => ( {
			pid: Number( pid ),
			parent: Number( parent ),
			bytes: Number( rss ) * 1024,
			command,
		} ) );
	const isFromPackage = ( command: string ) =>
		packagePaths.some( ( packagePath ) => command.startsWith( packagePath ) );

	const counted = new Set< number >();
	const pending = processes
		.filter( ( { pid, command } ) => rootPids.includes( pid ) || isFromPackage( command ) )
		.map( ( { pid } ) => pid );
	while ( pending.length ) {
		const pid = pending.pop() as number;
		if ( counted.has( pid ) ) {
			continue;
		}
		counted.add( pid );
		pending.push(
			...processes.filter( ( { parent } ) => parent === pid ).map( ( child ) => child.pid )
		);
	}

	const usage: Usage = { total: 0, parts: {} };
	for ( const { pid, bytes, command } of processes ) {
		if ( counted.has( pid ) ) {
			const part = partOf( command, isFromPackage( command ) );
			usage.total += bytes;
			usage.parts[ part ] = ( usage.parts[ part ] ?? 0 ) + bytes;
		}
	}
	return usage;
}

function describe( { total, parts }: Usage ): string {
	const megabytes = ( bytes: number ) => `${ ( bytes / BYTES_PER_MB ).toFixed( 0 ) } MB`;
	const split = Object.entries( parts )
		.sort( ( [ , a ], [ , b ] ) => b - a )
		.map( ( [ part, bytes ] ) => `${ part } ${ megabytes( bytes ) }` );
	return `${ megabytes( total ) } (${ split.join( ', ' ) })`;
}

test.describe( 'Memory Metrics', () => {
	test.skip( process.platform === 'win32', 'Reads process memory with ps' );

	const session = new E2ESession();
	const siteName = 'Memory-Test-Site';

	test.afterAll( async () => {
		await session.cleanup();
	} );

	// eslint-disable-next-line no-empty-pattern
	test( 'measure the memory of Studio at rest and at work', async ( {}, testInfo ) => {
		test.setTimeout( BROWSER_INSTALL_TIMEOUT_MS + SITE_TIMEOUT_MS + TOOL_TIMEOUT_MS * SCREENSHOTS );

		const buildPath = findLatestBuild( path.resolve( __dirname, '../../../apps/studio/out' ) );
		const app = parseElectronApp( buildPath );
		const nodeBinary = path.join( app.resourcesDir, 'bin', 'node' );
		const cli = path.join( app.resourcesDir, 'cli', 'main.mjs' );

		// Without the browsers of the build's own Playwright, Studio runs an installed Chrome
		// where there is one, and the numbers would follow the machine rather than the build.
		const playwrightCli = path.join(
			path.dirname( createRequire( cli ).resolve( 'playwright/package.json' ) ),
			'cli.js'
		);
		execFileSync( nodeBinary, [ playwrightCli, 'install', 'chromium' ], {
			stdio: 'inherit',
			timeout: BROWSER_INSTALL_TIMEOUT_MS,
		} );

		await session.launch();
		const appPid = session.electronApp.process().pid;
		if ( appPid === undefined ) {
			throw new Error( 'The Studio app has no process' );
		}

		const packagePaths = [ ...new Set( [ buildPath, fs.realpathSync( buildPath ) ] ) ];
		const rootPids = [ appPid ];
		const measure = () => studioMemory( packagePaths, rootPids );

		let peak: Usage = { total: 0, parts: {} };
		const sampler = setInterval( () => {
			try {
				const usage = measure();
				if ( usage.total > peak.total ) {
					peak = usage;
				}
			} catch {
				// A process left between ps listing it and reading it.
			}
		}, SAMPLE_INTERVAL_MS );

		let server: ChildProcessWithoutNullStreams | undefined;
		try {
			await new AddSite( session.mainWindow ).createSite( { siteName } );
			await new Sidebar( session.mainWindow ).expectRunning( siteName );
			const url = await session.getSiteUrl( siteName );

			// The agent tools, reached the way an MCP client reaches them: no AI provider needed.
			server = spawn( nodeBinary, [ cli, 'mcp' ], {
				env: {
					...process.env,
					E2E: 'true',
					E2E_APP_DATA_PATH: session.appDataPath,
					E2E_HOME_PATH: session.homePath,
					DEV_CONFIG_DIR: session.configPath,
					STUDIO_PROCESS_MANAGER_HOME: session.daemonHomePath,
				},
			} );
			if ( server.pid === undefined ) {
				throw new Error( `Could not start ${ nodeBinary } ${ cli } mcp` );
			}
			rootPids.push( server.pid );

			const client = new McpClient( server );
			await client.initialize();
			for ( let taken = 0; taken < SCREENSHOTS; taken++ ) {
				const result = await client.callTool( 'take_screenshot', { url } );
				if ( result.isError ) {
					const text = ( result.content ?? [] ).map( ( part ) => part.text ?? '' ).join( '\n' );
					throw new Error( `take_screenshot failed: ${ text }` );
				}
			}

			// At rest: the app is open, the site runs, and the tools' browser waits for a call.
			await new Promise( ( resolve ) => setTimeout( resolve, SETTLE_MS ) );
			const idleSamples: Usage[] = [];
			for ( let sample = 0; sample < IDLE_SAMPLES; sample++ ) {
				idleSamples.push( measure() );
				await new Promise( ( resolve ) => setTimeout( resolve, 1000 ) );
			}
			const idleTotal = median( idleSamples.map( ( { total } ) => total ) );
			const idle = idleSamples.find( ( { total } ) => total === idleTotal ) ?? idleSamples[ 0 ];
			if ( ! idle.parts.browser || ! idle.parts.app ) {
				throw new Error( `Found no app or no browser process: ${ describe( idle ) }` );
			}

			console.log( `Memory at rest: ${ describe( idle ) }` );
			console.log( `Memory at peak: ${ describe( peak ) }` );

			await testInfo.attach( 'results', {
				body: JSON.stringify( { memoryIdle: idle.total, memoryPeak: peak.total } ),
				contentType: 'application/json',
			} );
		} finally {
			clearInterval( sampler );
			server?.stdin.end();
			server?.kill();
		}
	} );
} );
