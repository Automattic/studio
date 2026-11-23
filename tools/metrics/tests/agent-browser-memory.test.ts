import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import http from 'http';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { test } from '@playwright/test';
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';

const SCREENSHOTS = 3;
const SAMPLE_INTERVAL_MS = 100;
const SETTLE_MS = 3000;
const TOOL_TIMEOUT_MS = 120_000;
const BROWSER_INSTALL_TIMEOUT_MS = 10 * 60_000;

// A page with enough layout, paint and images to stand for a site's front page, served from
// this process so the numbers don't depend on a WordPress site.
function pageHtml(): string {
	const card = ( index: number ) => `<article>
		<img alt="" width="320" height="180" src="data:image/svg+xml,${ encodeURIComponent(
			`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${
				index * 23
			} 70% 55%)"/><stop offset="1" stop-color="hsl(${
				index * 23 + 60
			} 70% 35%)"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><circle cx="${
				60 + index * 5
			}" cy="90" r="48" fill="rgba(255,255,255,.35)"/></svg>`
		) }">
		<h2>Post number ${ index + 1 }</h2>
		<p>${ 'Studio runs WordPress sites on your computer, and its agent looks at them in a browser. '.repeat(
			3
		) }</p>
	</article>`;
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Browser memory</title><style>
		body { margin: 0; font: 16px/1.6 system-ui, sans-serif; color: #1e1e1e; background: #f6f7f7; }
		header { padding: 64px 48px; color: #fff; background: linear-gradient( 135deg, #3858e9, #1d2327 ); }
		header h1 { margin: 0; font-size: 56px; }
		main { display: grid; grid-template-columns: repeat( auto-fill, minmax( 280px, 1fr ) ); gap: 32px; padding: 48px; }
		article { overflow: hidden; border-radius: 12px; background: #fff; box-shadow: 0 8px 24px rgba( 0, 0, 0, 0.12 ); }
		article img { display: block; width: 100%; height: auto; }
		article h2, article p { margin: 16px 24px; }
	</style></head><body><header><h1>Browser memory</h1><p>A fixed page for Studio's metrics.</p></header>
	<main>${ Array.from( { length: 48 }, ( _, index ) => card( index ) ).join(
		''
	) }</main></body></html>`;
}

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

/**
 * The resident memory, in bytes, of every browser process under `rootPid`. Chromium shares
 * pages between its processes, so the sum counts some memory more than once: it follows the
 * browser's real use, and is higher than it.
 */
function browserMemory( rootPid: number ): number {
	const processes = execFileSync( 'ps', [ '-axo', 'pid=,ppid=,rss=,comm=' ] )
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
	let total = 0;
	const parents = [ rootPid ];
	while ( parents.length ) {
		const parent = parents.pop();
		for ( const child of processes.filter( ( candidate ) => candidate.parent === parent ) ) {
			parents.push( child.pid );
			if ( /chrom|headless[_-]shell/i.test( path.basename( child.command ) ) ) {
				total += child.bytes;
			}
		}
	}
	return total;
}

test.describe( 'Agent Browser Memory Metrics', () => {
	test.skip( process.platform === 'win32', 'Reads process memory with ps' );

	// eslint-disable-next-line no-empty-pattern
	test( 'measure the memory of the browser behind the agent tools', async ( {}, testInfo ) => {
		test.setTimeout( BROWSER_INSTALL_TIMEOUT_MS + TOOL_TIMEOUT_MS * SCREENSHOTS );

		const app = parseElectronApp(
			findLatestBuild( path.resolve( __dirname, '../../../apps/studio/out' ) )
		);
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

		const html = pageHtml();
		const pageServer = http.createServer( ( _request, response ) => {
			response.writeHead( 200, { 'Content-Type': 'text/html; charset=utf-8' } );
			response.end( html );
		} );
		await new Promise< void >( ( resolve ) => pageServer.listen( 0, '127.0.0.1', resolve ) );
		const address = pageServer.address();
		if ( ! address || typeof address === 'string' ) {
			throw new Error( 'The page server has no port' );
		}
		const url = `http://127.0.0.1:${ address.port }/`;

		// The folders the e2e sessions use, so the run reads and writes no real Studio data.
		const sessionPath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-metrics-browser-' ) );
		const server = spawn( nodeBinary, [ cli, 'mcp' ], {
			env: {
				...process.env,
				E2E: 'true',
				E2E_APP_DATA_PATH: path.join( sessionPath, 'appData' ),
				DEV_CONFIG_DIR: path.join( sessionPath, 'config' ),
				STUDIO_PROCESS_MANAGER_HOME: path.join( sessionPath, 'daemon' ),
			},
		} );
		if ( server.pid === undefined ) {
			throw new Error( `Could not start ${ nodeBinary } ${ cli } mcp` );
		}
		const serverPid = server.pid;

		let peak = 0;
		const sampler = setInterval( () => {
			try {
				peak = Math.max( peak, browserMemory( serverPid ) );
			} catch {
				// A process left between ps listing it and reading it.
			}
		}, SAMPLE_INTERVAL_MS );

		try {
			const client = new McpClient( server );
			await client.initialize();

			for ( let taken = 0; taken < SCREENSHOTS; taken++ ) {
				const result = await client.callTool( 'take_screenshot', { url } );
				if ( result.isError ) {
					const text = ( result.content ?? [] ).map( ( part ) => part.text ?? '' ).join( '\n' );
					throw new Error( `take_screenshot failed: ${ text }` );
				}
			}

			// The tools keep the browser open between calls: this is what it holds while it waits.
			await new Promise( ( resolve ) => setTimeout( resolve, SETTLE_MS ) );
			const idle = browserMemory( serverPid );
			if ( ! idle || ! peak ) {
				throw new Error( 'Found no browser process under studio mcp' );
			}

			await testInfo.attach( 'results', {
				body: JSON.stringify( {
					agentBrowserMemoryPeak: peak,
					agentBrowserMemoryIdle: idle,
				} ),
				contentType: 'application/json',
			} );
		} finally {
			clearInterval( sampler );
			server.stdin.end();
			server.kill();
			pageServer.close();
			fs.rmSync( sessionPath, { recursive: true, force: true } );
		}
	} );
} );
