import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import chokidar, { type FSWatcher } from 'chokidar';
import * as pty from 'node-pty';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Router, Request, Response } from 'express';
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';

// Embedded terminal sessions running the official `claude` CLI. Running the
// CLI interactively (instead of driving it programmatically over ACP or the
// Agent SDK) is the path Anthropic bills against the full Pro/Max
// subscription pool, and the one Zed recommends for subscription users.
// Studio contributes the working directory (the site), the `wordpress-studio`
// MCP server, and a file watcher that refreshes the site preview.

const OUTPUT_REPLAY_LIMIT = 200_000;
const PREVIEW_RELOAD_DEBOUNCE_MS = 800;

export interface TerminalManagerOptions {
	cliBinary: string;
	nodeBinary: string;
	sseSend: ( message: { channel: string; payload: unknown } ) => void;
	resolveSite: (
		siteId: string
	) => Promise< { id: string; name: string; path: string } | undefined >;
	allowedOrigins: Set< string >;
}

interface TerminalSession {
	id: string;
	siteId: string;
	sitePath: string;
	pty: pty.IPty;
	sockets: Set< WebSocket >;
	replayBuffer: string;
	watcher?: FSWatcher;
	reloadTimer?: NodeJS.Timeout;
	mcpConfigPath: string;
	exited: boolean;
}

function findClaudeBinary(): string | undefined {
	const pathEntries = ( process.env.PATH ?? '' ).split( path.delimiter );
	// `studio ui` may run from a launchd/GUI context with a minimal PATH, so
	// also probe the default install locations.
	const candidates = [
		...pathEntries.map( ( entry ) => path.join( entry, 'claude' ) ),
		path.join( os.homedir(), '.local', 'bin', 'claude' ),
		'/usr/local/bin/claude',
		'/opt/homebrew/bin/claude',
	];
	return candidates.find( ( candidate ) => {
		try {
			fs.accessSync( candidate, fs.constants.X_OK );
			return true;
		} catch {
			return false;
		}
	} );
}

// npm can drop the exec bit on node-pty's bundled `spawn-helper` (the pty
// fork then dies with `posix_spawnp failed.`). Restore it before spawning.
function ensureSpawnHelperExecutable(): void {
	if ( process.platform === 'win32' ) {
		return;
	}
	try {
		const prebuildsDir = path.join(
			path.dirname( require.resolve( 'node-pty/package.json' ) ),
			'prebuilds'
		);
		for ( const entry of fs.readdirSync( prebuildsDir ) ) {
			const helper = path.join( prebuildsDir, entry, 'spawn-helper' );
			if ( fs.existsSync( helper ) ) {
				fs.chmodSync( helper, 0o755 );
			}
		}
	} catch {
		// Best-effort; the spawn error will surface the problem if this fails.
	}
}

export function createTerminalManager( options: TerminalManagerOptions ) {
	const { cliBinary, nodeBinary, sseSend, resolveSite, allowedOrigins } = options;
	const sessions = new Map< string, TerminalSession >();
	const wss = new WebSocketServer( { noServer: true } );
	ensureSpawnHelperExecutable();

	function writeMcpConfig( terminalId: string ): string {
		const configPath = path.join( os.tmpdir(), `studio-terminal-mcp-${ terminalId }.json` );
		fs.writeFileSync(
			configPath,
			JSON.stringify(
				{
					mcpServers: {
						'wordpress-studio': {
							command: nodeBinary,
							args: [ cliBinary, 'mcp' ],
						},
					},
				},
				null,
				2
			)
		);
		return configPath;
	}

	function startPreviewWatcher( session: TerminalSession ): void {
		const watcher = chokidar.watch( session.sitePath, {
			ignored: [ /(^|[/\\])\../, /node_modules/, /wp-content[/\\]uploads/ ],
			ignoreInitial: true,
			depth: 8,
		} );
		watcher.on( 'all', () => {
			if ( session.reloadTimer ) {
				clearTimeout( session.reloadTimer );
			}
			session.reloadTimer = setTimeout( () => {
				// Ride the agent SSE channel the UI already listens on; the
				// terminal view subscribes with this synthetic session id.
				sseSend( {
					channel: 'agent',
					payload: {
						runId: `terminal-${ session.id }`,
						sessionId: `terminal-${ session.siteId }`,
						event: { type: 'preview.reload', timestamp: new Date().toISOString() },
					},
				} );
			}, PREVIEW_RELOAD_DEBOUNCE_MS );
		} );
		session.watcher = watcher;
	}

	async function destroySession( session: TerminalSession ): Promise< void > {
		sessions.delete( session.siteId );
		if ( session.reloadTimer ) {
			clearTimeout( session.reloadTimer );
		}
		await session.watcher?.close().catch( () => undefined );
		for ( const socket of session.sockets ) {
			socket.close();
		}
		session.sockets.clear();
		if ( ! session.exited ) {
			try {
				session.pty.kill();
			} catch {
				// Already gone.
			}
		}
		fs.rm( session.mcpConfigPath, { force: true }, () => undefined );
	}

	function broadcast( session: TerminalSession, message: unknown ): void {
		const serialized = JSON.stringify( message );
		for ( const socket of session.sockets ) {
			if ( socket.readyState === socket.OPEN ) {
				socket.send( serialized );
			}
		}
	}

	async function createSession(
		siteId: string
	): Promise<
		| { ok: true; session: TerminalSession; reused: boolean }
		| { ok: false; status: number; error: string }
	> {
		const existing = sessions.get( siteId );
		if ( existing && ! existing.exited ) {
			return { ok: true, session: existing, reused: true };
		}

		const site = await resolveSite( siteId );
		if ( ! site ) {
			return { ok: false, status: 404, error: 'Site not found' };
		}

		const claudeBinary = findClaudeBinary();
		if ( ! claudeBinary ) {
			return {
				ok: false,
				status: 409,
				error:
					'Claude Code CLI not found. Install it (https://claude.com/claude-code) and sign in with `claude` before opening a Studio terminal.',
			};
		}

		const id = randomUUID();
		const mcpConfigPath = writeMcpConfig( id );
		const ptyProcess = pty.spawn( claudeBinary, [ '--mcp-config', mcpConfigPath ], {
			name: 'xterm-256color',
			cols: 80,
			rows: 24,
			cwd: site.path,
			env: { ...process.env, TERM_PROGRAM: 'wordpress-studio' } as Record< string, string >,
		} );

		const session: TerminalSession = {
			id,
			siteId,
			sitePath: site.path,
			pty: ptyProcess,
			sockets: new Set(),
			replayBuffer: '',
			mcpConfigPath,
			exited: false,
		};

		ptyProcess.onData( ( data ) => {
			session.replayBuffer = ( session.replayBuffer + data ).slice( -OUTPUT_REPLAY_LIMIT );
			broadcast( session, { type: 'output', data } );
		} );
		ptyProcess.onExit( ( { exitCode } ) => {
			session.exited = true;
			broadcast( session, { type: 'exit', exitCode } );
			void destroySession( session );
		} );

		startPreviewWatcher( session );
		sessions.set( siteId, session );
		return { ok: true, session, reused: false };
	}

	function registerRoutes( api: Router ): void {
		api.post( '/terminals', ( req: Request, res: Response ) => {
			const { siteId } = req.body as { siteId?: string };
			if ( ! siteId ) {
				res.status( 400 ).json( { error: 'siteId is required' } );
				return;
			}
			createSession( siteId ).then(
				( result ) => {
					if ( ! result.ok ) {
						res.status( result.status ).json( { error: result.error } );
						return;
					}
					res.json( {
						terminalId: result.session.id,
						siteId: result.session.siteId,
						reused: result.reused,
					} );
				},
				( error: unknown ) => {
					res
						.status( 500 )
						.json( { error: error instanceof Error ? error.message : String( error ) } );
				}
			);
		} );

		api.delete( '/terminals/:id', ( req: Request, res: Response ) => {
			const session = [ ...sessions.values() ].find( ( s ) => s.id === req.params.id );
			if ( ! session ) {
				res.sendStatus( 404 );
				return;
			}
			void destroySession( session );
			res.sendStatus( 204 );
		} );
	}

	function handleUpgrade( server: Server ): void {
		server.on( 'upgrade', ( request: IncomingMessage, socket: Duplex, head: Buffer ) => {
			const url = new URL( request.url ?? '/', 'http://localhost' );
			const match = /^\/api\/terminals\/([^/]+)\/ws$/.exec( url.pathname );
			if ( ! match ) {
				socket.destroy();
				return;
			}
			// Browsers always send Origin on WebSocket upgrades; enforce the same
			// allowlist as the HTTP routes so arbitrary pages can't attach to a
			// shell. Non-browser clients (no Origin) are allowed, matching the
			// HTTP middleware's stance for curl and same-origin requests.
			const origin = request.headers.origin;
			if ( origin && ! allowedOrigins.has( origin ) ) {
				socket.destroy();
				return;
			}
			const session = [ ...sessions.values() ].find( ( s ) => s.id === match[ 1 ] );
			if ( ! session || session.exited ) {
				socket.destroy();
				return;
			}
			wss.handleUpgrade( request, socket, head, ( ws ) => {
				session.sockets.add( ws );
				if ( session.replayBuffer ) {
					ws.send( JSON.stringify( { type: 'output', data: session.replayBuffer } ) );
				}
				ws.on( 'message', ( raw ) => {
					let message: { type?: string; data?: string; cols?: number; rows?: number };
					try {
						message = JSON.parse( raw.toString() );
					} catch {
						return;
					}
					if ( message.type === 'input' && typeof message.data === 'string' ) {
						session.pty.write( message.data );
					} else if (
						message.type === 'resize' &&
						typeof message.cols === 'number' &&
						typeof message.rows === 'number' &&
						message.cols > 0 &&
						message.rows > 0
					) {
						session.pty.resize( Math.floor( message.cols ), Math.floor( message.rows ) );
					}
				} );
				ws.on( 'close', () => {
					session.sockets.delete( ws );
				} );
			} );
		} );
	}

	async function closeAll(): Promise< void > {
		await Promise.all( [ ...sessions.values() ].map( ( session ) => destroySession( session ) ) );
		wss.close();
	}

	return { registerRoutes, handleUpgrade, closeAll };
}
