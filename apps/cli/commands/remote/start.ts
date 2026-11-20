import os from 'os';
import { getDefaultLanAddress } from '@studio/common/lib/network-address';
import {
	describeMissingConnection,
	pickRemoteConnection,
	REMOTE_CONNECTION_KINDS,
	REMOTE_CONNECTION_REQUESTS,
	remoteConnectionName,
	type ReadyRemoteConnection,
	type RemoteConnectionRequest,
} from '@studio/common/lib/remote-connection';
import { findTailscaleCli, readTailscaleState } from '@studio/common/lib/tailscale';
import { __, sprintf } from '@wordpress/i18n';
import { isProcessAlive } from 'cli/lib/daemon-client';
import { printPairingCode } from 'cli/lib/remote-pairing';
import {
	startTailscaleServe,
	waitForTailscaleHttps,
	type TailscaleServe,
} from 'cli/lib/tailscale-serve';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const DEFAULT_REMOTE_PORT = 8082;
// How often a connection through Tailscale checks that Tailscale still runs.
const TAILSCALE_CHECK_MS = 30_000;

export async function runCommand( options: {
	host?: string;
	port?: number;
	connection?: RemoteConnectionRequest;
} ): Promise< void > {
	const logger = new Logger< string >();
	// Started by the Studio desktop app, which talks to it over IPC: the app
	// shows the codes and the errors, and remote mode stops with the app.
	const startedByApp = typeof process.send === 'function';
	const request = options.connection ?? 'auto';
	if ( options.host && request !== 'auto' && request !== 'local' ) {
		logger.reportError(
			new LoggerError( __( '--host works only with the local network connection.' ) )
		);
		return;
	}
	// `--host` names the local network address, and the local network needs no Tailscale.
	const wanted = options.host ? 'local' : request;
	const inputs = {
		tailscale: wanted === 'local' ? ( { installed: false } as const ) : await readTailscaleState(),
		lanAddress: options.host ?? getDefaultLanAddress(),
	};
	// Asked for by name: that one. Automatic: each ready one in turn, the
	// safest first, until one starts.
	const choices: ReadyRemoteConnection[] = [];
	for ( const kind of wanted === 'auto' ? REMOTE_CONNECTION_KINDS : [ wanted ] ) {
		const choice = pickRemoteConnection( kind, inputs );
		if ( choice.ok ) {
			choices.push( choice );
		}
	}
	if ( ! choices.length ) {
		const choice = pickRemoteConnection( wanted, inputs );
		const missing = choice.ok ? 'network' : choice.missing;
		let message = describeMissingConnection( missing );
		if ( missing === 'network' ) {
			message = startedByApp
				? __( 'No network address found. Connect this computer to a network, then try again.' )
				: __( 'No network address found. Pass one with --host.' );
		}
		logger.reportError( new LoggerError( message ) );
		return;
	}

	let server: Awaited< ReturnType< typeof import('@studio/local').startLocalServer > > | undefined;
	let serve: TailscaleServe | undefined;
	let stopListening = () => {};
	try {
		const port =
			options.port ?? Number( process.env.STUDIO_REMOTE_SERVER_PORT ?? DEFAULT_REMOTE_PORT );
		// A port the server cannot listen on throws after it has started its
		// `_events` child, past the cleanup of a failed listen.
		if ( ! Number.isInteger( port ) || port < 0 || port > 65535 ) {
			throw new LoggerError( __( 'The port must be a whole number from 0 to 65535.' ) );
		}

		// `@studio/local` is bundled into the CLI from source; the dynamic import
		// keeps Express off the startup path of every other command.
		const [
			{ startLocalServer },
			{ getSessionsDirectory },
			{ STUDIO_SITES_ROOT },
			{
				claimRemoteServerInfo,
				clearPairingCodes,
				clearRemoteServerInfo,
				getRemoteInstanceId,
				readRemoteServerInfo,
			},
			{ capturePreview },
		] = await Promise.all( [
			import( '@studio/local' ),
			import( '@studio/common/lib/well-known-paths' ),
			import( 'cli/lib/site-paths' ),
			import( '@studio/common/lib/remote-access' ),
			import( 'cli/lib/capture-preview' ),
		] );

		// Two servers would overwrite each other's record and share one events socket.
		const running = await readRemoteServerInfo();
		if ( running && isProcessAlive( running.pid ) ) {
			logger.reportError(
				new LoggerError( sprintf( __( 'Remote mode is already running at %s.' ), running.url ) )
			);
			return;
		}

		let stopping = false;
		let tailscaleCheck: ReturnType< typeof setInterval > | undefined;
		// Ends what this command started. With a reason, remote mode stopped by
		// itself: the reason is reported (to the app too) and the exit code says
		// it failed.
		const shutdown = ( reason?: string ) => {
			if ( stopping ) {
				return;
			}
			stopping = true;
			clearInterval( tailscaleCheck );
			if ( reason ) {
				logger.reportError( new LoggerError( reason ) );
			}
			serve?.stop();
			void clearPairingCodes()
				.catch( () => undefined )
				.then( () => clearRemoteServerInfo( process.pid ) )
				.catch( () => undefined )
				.then( () => server?.close() )
				.finally( () => process.exit( reason ? 1 : 0 ) );
		};
		// Before anything starts, so a stop at any moment ends all of it. A crash
		// still ends `tailscale serve` on the way out.
		const onStop = () => shutdown();
		process.on( 'SIGINT', onStop );
		process.on( 'SIGTERM', onStop );
		process.once( 'exit', () => serve?.stop() );
		// A `disconnect` listener keeps the IPC channel, and so the process, alive:
		// a start that fails takes them all off again, so the process ends and the
		// app gets the reason.
		stopListening = () => {
			process.off( 'SIGINT', onStop );
			process.off( 'SIGTERM', onStop );
			process.off( 'disconnect', onStop );
		};
		// The app was killed or quit without stopping it. Node does not replay
		// `disconnect`, so an app that went away before this point is checked too.
		if ( startedByApp ) {
			process.on( 'disconnect', onStop );
			if ( ! process.connected ) {
				shutdown();
				return;
			}
		}

		// A code left from an earlier run must not work on this one.
		await clearPairingCodes();

		let started: { choice: ReadyRemoteConnection; url: string; port: number } | undefined;
		const skipped: string[] = [];
		for ( const choice of choices ) {
			const didNotStart = ( error: unknown ) =>
				sprintf(
					/* translators: %1$s: a connection, like "Tailscale HTTPS". %2$s: the reason, like "listen EADDRINUSE: …". */
					__( '%1$s did not start. %2$s' ),
					remoteConnectionName( choice.kind ),
					( error as Error ).message
				);
			try {
				server = await startLocalServer( {
					cliBinary: process.env.STUDIO_CLI_BIN ?? process.argv[ 1 ],
					sessionsRoot: getSessionsDirectory(),
					sitesRoot: STUDIO_SITES_ROOT,
					host: choice.host,
					port,
					remote: { label: os.hostname(), studioVersion: __STUDIO_CLI_VERSION__ },
					// Without it, every screenshot the phone asks for answers `no-browser`.
					capturePreview,
				} );
			} catch ( error ) {
				// Each connection listens on its own address: another program may
				// hold the port on one of them only.
				if ( stopping || wanted !== 'auto' ) {
					throw error;
				}
				skipped.push( didNotStart( error ) );
				continue;
			}
			// The port the server got, which `--port 0` leaves to the system.
			const listening = server.port;
			if ( choice.kind !== 'https' ) {
				started = { choice, url: server.url, port: listening };
				break;
			}
			// Tailscale takes HTTPS on the machine's name and forwards it to the
			// loopback address the server listens on.
			const url = choice.url( listening );
			try {
				const cli = findTailscaleCli();
				if ( ! cli ) {
					throw new Error( describeMissingConnection( 'tailscale' ) );
				}
				serve = startTailscaleServe( cli, listening );
				await waitForTailscaleHttps( {
					url,
					instanceId: await getRemoteInstanceId(),
					ended: serve.ended,
				} );
				started = { choice, url, port: listening };
				break;
			} catch ( error ) {
				serve?.stop();
				serve = undefined;
				await server.close();
				server = undefined;
				if ( stopping ) {
					return;
				}
				const reason = didNotStart( error );
				// Asked for by name, this is the end; Automatic tries the next one.
				if ( wanted !== 'auto' ) {
					throw new LoggerError( reason );
				}
				skipped.push( reason );
			}
		}
		// Stopped while a server started: `shutdown` has it.
		if ( stopping ) {
			return;
		}
		if ( ! started ) {
			throw new LoggerError( skipped.join( ' ' ) );
		}
		const { choice, url } = started;

		// Another `studio remote` may have started at the same time, or while this
		// one waited for HTTPS: only one of them gets the record.
		const other = await claimRemoteServerInfo(
			{
				url,
				pid: process.pid,
				connection: choice.kind,
				// The desktop app shows why Automatic did not take a safer connection.
				...( skipped.length > 0 && { fallbackReason: skipped.join( ' ' ) } ),
			},
			isProcessAlive
		);
		if ( other ) {
			throw new LoggerError( sprintf( __( 'Remote mode is already running at %s.' ), other.url ) );
		}

		if ( ! startedByApp ) {
			console.log( '' );
			for ( const reason of skipped ) {
				console.log( reason );
			}
			console.log(
				__( 'Studio remote mode is running. Scan this code with the Studio phone app:' )
			);
			console.log( sprintf( __( 'Connection: %s' ), remoteConnectionName( choice.kind ) ) );
			console.log( '' );
			await printPairingCode( url );
			console.log( '' );
			console.log(
				__(
					'A paired device can send prompts to Studio Code, and Studio Code can run commands on this computer. Pair only devices you own.'
				)
			);
			if ( choice.kind === 'local' ) {
				console.log(
					__(
						'On a shared network this connection is not encrypted. Use Tailscale or another VPN when you can.'
					)
				);
			}
			console.log( '' );
			console.log( __( 'Press Ctrl+C to stop.' ) );
		}

		// Phones can only reach a connection through Tailscale while Tailscale runs
		// with the same address. One slow or failed read is not enough to stop.
		if ( choice.kind !== 'local' ) {
			let misses = 0;
			tailscaleCheck = setInterval( () => {
				void readTailscaleState().then( ( state ) => {
					const now = pickRemoteConnection( choice.kind, {
						tailscale: state,
						lanAddress: undefined,
					} );
					let problem: string | undefined;
					if ( ! now.ok ) {
						problem = describeMissingConnection( now.missing );
					} else if ( now.url( started.port ) !== url ) {
						problem = __( "This computer's address on the tailnet changed." );
					}
					misses = problem ? misses + 1 : 0;
					if ( problem && misses >= 2 ) {
						shutdown( problem );
					}
				} );
			}, TAILSCALE_CHECK_MS );
		}
		void serve?.ended.then( ( message ) =>
			shutdown(
				sprintf(
					/* translators: %s: the reason Tailscale gave. */
					__( 'Tailscale HTTPS stopped: %s' ),
					message ?? __( 'tailscale serve ended.' )
				)
			)
		);
	} catch ( error ) {
		// Nothing this command started may outlive it, nor keep it alive.
		stopListening();
		serve?.stop();
		await server?.close().catch( () => undefined );
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to start remote mode' ), error ) );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: [ 'start', '$0' ],
		describe: __( 'Start remote mode and show a pairing code' ),
		builder: ( startYargs ) =>
			startYargs
				.option( 'connection', {
					type: 'string',
					choices: REMOTE_CONNECTION_REQUESTS,
					default: 'auto',
					description: __(
						'How phones connect: auto (the safest one that is ready), https (Tailscale HTTPS), tailnet, or local (the local network)'
					),
				} )
				.option( 'host', {
					type: 'string',
					description: __(
						"Address to listen on, for the local network connection. Defaults to this computer's network address"
					),
				} )
				.option( 'port', {
					type: 'number',
					description: __( 'Port to listen on' ),
				} ),
		handler: async ( argv ) => {
			await runCommand( {
				connection: argv.connection as RemoteConnectionRequest,
				host: argv.host as string | undefined,
				port: argv.port as number | undefined,
			} );
		},
	} );
};
