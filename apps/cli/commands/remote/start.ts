import os from 'os';
import { __, sprintf } from '@wordpress/i18n';
import { isProcessAlive } from 'cli/lib/daemon-client';
import { getDefaultLanAddress } from 'cli/lib/network-address';
import { printPairingCode } from 'cli/lib/remote-pairing';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const DEFAULT_REMOTE_PORT = 8082;

export async function runCommand( options: { host?: string; port?: number } ): Promise< void > {
	const logger = new Logger< string >();
	// Started by the Studio desktop app, which talks to it over IPC: the app
	// shows the codes and the errors, and remote mode stops with the app.
	const startedByApp = typeof process.send === 'function';
	const host = options.host ?? getDefaultLanAddress();
	if ( ! host ) {
		logger.reportError(
			new LoggerError(
				startedByApp
					? __( 'No network address found. Connect this computer to a network, then try again.' )
					: __( 'No network address found. Pass one with --host.' )
			)
		);
		return;
	}

	try {
		const port =
			options.port ?? Number( process.env.STUDIO_REMOTE_SERVER_PORT ?? DEFAULT_REMOTE_PORT );

		// `@studio/local` is bundled into the CLI from source; the dynamic import
		// keeps Express off the startup path of every other command.
		const [
			{ startLocalServer },
			{ getSessionsDirectory },
			{ STUDIO_SITES_ROOT },
			{ clearPairingCodes, clearRemoteServerInfo, readRemoteServerInfo, setRemoteServerInfo },
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

		// A code left from an earlier run must not work on this one.
		await clearPairingCodes();

		const server = await startLocalServer( {
			cliBinary: process.env.STUDIO_CLI_BIN ?? process.argv[ 1 ],
			sessionsRoot: getSessionsDirectory(),
			sitesRoot: STUDIO_SITES_ROOT,
			host,
			port,
			remote: { label: os.hostname(), studioVersion: __STUDIO_CLI_VERSION__ },
			// Without it, every screenshot the phone asks for answers `no-browser`.
			capturePreview,
		} );
		await setRemoteServerInfo( { url: server.url, pid: process.pid } );

		if ( ! startedByApp ) {
			console.log( '' );
			console.log(
				__( 'Studio remote mode is running. Scan this code with the Studio phone app:' )
			);
			console.log( '' );
			await printPairingCode( server.url );
			console.log( '' );
			console.log(
				__(
					'A paired device can send prompts to Studio Code, and Studio Code can run commands on this computer. Pair only devices you own.'
				)
			);
			console.log(
				__(
					'On a shared network this connection is not encrypted. Use Tailscale or another VPN when you can.'
				)
			);
			console.log( '' );
			console.log( __( 'Press Ctrl+C to stop.' ) );
		}

		let stopping = false;
		const shutdown = () => {
			if ( stopping ) {
				return;
			}
			stopping = true;
			void clearPairingCodes()
				.catch( () => undefined )
				.then( () => clearRemoteServerInfo( process.pid ) )
				.catch( () => undefined )
				.then( () => server.close() )
				.finally( () => process.exit( 0 ) );
		};
		process.on( 'SIGINT', shutdown );
		process.on( 'SIGTERM', shutdown );
		// The app was killed or quit without stopping it. Node does not replay
		// `disconnect`, so an app that went away while this started is checked too.
		if ( startedByApp ) {
			process.on( 'disconnect', shutdown );
			if ( ! process.connected ) {
				shutdown();
			}
		}
	} catch ( error ) {
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
				.option( 'host', {
					type: 'string',
					description: __( "Address to listen on. Defaults to this computer's network address" ),
				} )
				.option( 'port', {
					type: 'number',
					description: __( 'Port to listen on' ),
				} ),
		handler: async ( argv ) => {
			await runCommand( {
				host: argv.host as string | undefined,
				port: argv.port as number | undefined,
			} );
		},
	} );
};
