import { getRemoteSessionLogPath } from '@studio/common/lib/well-known-paths';
import { __, sprintf } from '@wordpress/i18n';
import { loadRemoteSessionConfig } from 'cli/remote-session/config';
import {
	DaemonAlreadyRunningError,
	DaemonStartTimeoutError,
	getDaemonStatus,
	startDaemon,
	stopDaemon,
} from 'cli/remote-session/daemon';
import { runRemoteSession, RemoteSessionConfigError } from 'cli/remote-session/index';
import { StudioArgv } from 'cli/types';

interface StartArgs {
	detach?: boolean;
	remoteChatId?: number;
	remoteBot?: string;
}

function buildExtraArgs( argv: StartArgs ): string[] {
	const out: string[] = [];
	if ( typeof argv.remoteChatId === 'number' ) {
		out.push( '--remote-chat-id', String( argv.remoteChatId ) );
	}
	if ( typeof argv.remoteBot === 'string' && argv.remoteBot.length > 0 ) {
		out.push( '--remote-bot', argv.remoteBot );
	}
	return out;
}

async function runStart( argv: StartArgs ): Promise< void > {
	if ( argv.detach ) {
		// Validate config in the parent so we fail fast (e.g., missing token)
		// instead of silently spawning a child that exits immediately.
		try {
			await loadRemoteSessionConfig( {
				chat_id: argv.remoteChatId,
				bot: argv.remoteBot,
			} );
		} catch ( error ) {
			if ( error instanceof RemoteSessionConfigError ) {
				process.stderr.write( `${ error.message }\n` );
				process.exitCode = 1;
				return;
			}
			throw error;
		}

		try {
			const result = await startDaemon( { extraArgs: buildExtraArgs( argv ) } );
			process.stdout.write(
				sprintf(
					/* translators: 1: PID, 2: log file path */
					__( 'Remote-session daemon started (PID %1$d). Logs: %2$s\n' ),
					result.pid,
					getRemoteSessionLogPath()
				)
			);
		} catch ( error ) {
			if ( error instanceof DaemonAlreadyRunningError ) {
				process.stderr.write(
					sprintf(
						/* translators: %d: PID */
						__(
							'Remote-session daemon is already running (PID %d). Use `studio code remote-session stop` first.\n'
						),
						error.pid
					)
				);
				process.exitCode = 1;
				return;
			}
			if ( error instanceof DaemonStartTimeoutError ) {
				process.stderr.write( `${ error.message }\n` );
				process.exitCode = 1;
				return;
			}
			throw error;
		}
		return;
	}

	try {
		await runRemoteSession( {
			chat_id: argv.remoteChatId,
			bot: argv.remoteBot,
		} );
	} catch ( error ) {
		if ( error instanceof RemoteSessionConfigError ) {
			process.stderr.write( `${ error.message }\n` );
			process.exitCode = 1;
			return;
		}
		throw error;
	}
}

async function runStatus(): Promise< void > {
	const status = getDaemonStatus();
	if ( status.running && status.pid !== undefined ) {
		process.stdout.write(
			sprintf(
				/* translators: 1: PID, 2: log path, 3: PID file path */
				__( 'Remote-session daemon is running (PID %1$d).\nLogs: %2$s\nPID file: %3$s\n' ),
				status.pid,
				getRemoteSessionLogPath(),
				status.pidFile
			)
		);
		return;
	}
	if ( status.staleFileRemoved ) {
		process.stdout.write(
			__( 'Remote-session daemon is not running (cleaned up a stale PID file).\n' )
		);
		return;
	}
	process.stdout.write( __( 'Remote-session daemon is not running.\n' ) );
}

async function runStop(): Promise< void > {
	const result = await stopDaemon();
	if ( result.alreadyStopped ) {
		process.stdout.write( __( 'Remote-session daemon is not running.\n' ) );
		return;
	}
	if ( ! result.stopped ) {
		process.stderr.write(
			sprintf(
				/* translators: %d: PID */
				__(
					'Remote-session daemon (PID %d) did not exit after SIGKILL. PID file left in place.\n'
				),
				result.pid ?? 0
			)
		);
		process.exitCode = 1;
		return;
	}
	if ( result.usedSigKill ) {
		process.stdout.write(
			sprintf(
				/* translators: %d: PID */
				__( 'Remote-session daemon (PID %d) did not exit gracefully; sent SIGKILL.\n' ),
				result.pid ?? 0
			)
		);
		return;
	}
	process.stdout.write(
		sprintf(
			/* translators: %d: PID */
			__( 'Remote-session daemon (PID %d) stopped.\n' ),
			result.pid ?? 0
		)
	);
}

export const registerRemoteSessionCommand = ( yargs: StudioArgv ) => {
	return yargs.command(
		'remote-session',
		__( 'Manage the Telegram remote-session daemon' ),
		( remoteYargs ) => {
			remoteYargs.command( {
				command: 'start',
				describe: __( 'Start the remote-session bridge (foreground or detached)' ),
				builder: ( startYargs ) =>
					startYargs
						.option( 'detach', {
							type: 'boolean',
							default: false,
							description: __( 'Run as a background daemon and return immediately' ),
						} )
						.option( 'remote-chat-id', {
							type: 'number',
							description: __( 'Override the Telegram chat id to bind to' ),
						} )
						.option( 'remote-bot', {
							type: 'string',
							description: __( 'Override the Telegram bot name to use for replies' ),
						} ),
				handler: async ( argv ) => {
					await runStart( argv as StartArgs );
				},
			} );
			remoteYargs.command( {
				command: 'stop',
				describe: __( 'Stop the running remote-session daemon' ),
				handler: runStop,
			} );
			remoteYargs.command( {
				command: 'status',
				describe: __( 'Show the remote-session daemon status' ),
				handler: runStatus,
			} );
			remoteYargs
				.version( false )
				.demandCommand( 1, __( 'You must provide a valid remote-session command' ) );
		}
	);
};
