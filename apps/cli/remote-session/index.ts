import { getRemoteSessionLogPath } from '@studio/common/lib/well-known-paths';
import { bumpAggregatedUniqueStat, bumpStat, getPlatformMetric } from 'cli/lib/bump-stat';
import { StatsGroup, StatsMetric } from 'cli/lib/types/bump-stats';
import {
	RemoteSessionConfigError,
	loadRemoteSessionConfig,
	type RemoteSessionOverrides,
} from 'cli/remote-session/config';
import { installDaemonChildHooks, isDaemonChild } from 'cli/remote-session/daemon';
import { RemoteSessionLogger } from 'cli/remote-session/logger';
import { runPollLoop } from 'cli/remote-session/poll-loop';
import { respondMessage } from 'cli/remote-session/telegram-client';

export { RemoteSessionConfigError };

export interface RunRemoteSessionOptions {
	/** Honors the top-level `--avoid-telemetry` flag. When true, no bump stats are emitted. */
	avoidTelemetry?: boolean;
}

/**
 * Entry point for `studio code --remote-session` and `studio code remote-session
 * start`. Validates config, enters the poll loop, and returns when the loop
 * exits (detach, Ctrl-C, or fatal error). When invoked as the detached child of
 * `start --detach` (env var `STUDIO_REMOTE_SESSION_DAEMON_CHILD=1`), it also
 * writes a PID file that the `stop` / `status` subcommands and the
 * `/remote-session` REPL slash command consult.
 */
export async function runRemoteSession(
	overrides: RemoteSessionOverrides = {},
	{ avoidTelemetry = false }: RunRemoteSessionOptions = {}
): Promise< void > {
	const config = await loadRemoteSessionConfig( overrides );
	const runningAsDaemon = isDaemonChild();
	const telemetryEnabled = __ENABLE_CLI_TELEMETRY__ && ! avoidTelemetry;

	if ( telemetryEnabled ) {
		// Total starts per platform (every invocation, daemon child or foreground).
		bumpStat( StatsGroup.STUDIO_CLI_DOLLY_START, getPlatformMetric() );
		// Weekly/monthly unique = "Dolly active users" headcount, mirroring the launch stats pattern.
		bumpAggregatedUniqueStat(
			StatsGroup.STUDIO_CLI_DOLLY_WEEKLY_UNIQ,
			StatsMetric.SUCCESS,
			'weekly'
		).catch( () =>
			console.error( 'Failed to bump stat:', StatsGroup.STUDIO_CLI_DOLLY_WEEKLY_UNIQ )
		);
		bumpAggregatedUniqueStat(
			StatsGroup.STUDIO_CLI_DOLLY_MONTHLY_UNIQ,
			StatsMetric.SUCCESS,
			'monthly'
		).catch( () =>
			console.error( 'Failed to bump stat:', StatsGroup.STUDIO_CLI_DOLLY_MONTHLY_UNIQ )
		);
	}
	if ( runningAsDaemon ) {
		// Detached child: claim the PID file. The hook removes it on `exit` and
		// (on POSIX) on SIGHUP. SIGINT/SIGTERM go through the existing graceful
		// detach path below; the `exit` event still fires afterwards.
		installDaemonChildHooks();
	}
	// In foreground mode the interactive REPL is blocked, so stdout is free
	// and we stream activity there alongside the log file. As a daemon, stdout
	// is `/dev/null`, so mirroring is wasted work and we skip it.
	const logger = new RemoteSessionLogger( { mirrorToStdout: ! runningAsDaemon } );
	const logPath = getRemoteSessionLogPath();
	logger.info( 'Remote session starting', {
		base_url: config.base_url,
		has_chat_id: config.chat_id !== undefined,
		bot: config.bot,
		poll_interval_seconds: config.poll_interval_seconds,
		long_poll_timeout_seconds: config.long_poll_timeout_seconds,
		turn_timeout_seconds: config.turn_timeout_seconds,
		debug: process.env.STUDIO_REMOTE_DEBUG === '1',
		daemon: runningAsDaemon,
	} );
	if ( ! runningAsDaemon ) {
		process.stdout.write( `Remote session log: ${ logPath }\n` );
	}

	const { done, detach } = await runPollLoop( {
		config,
		deps: { logger },
		telemetryEnabled,
		onAttached: () => {
			if ( runningAsDaemon ) {
				return;
			}
			const target =
				config.chat_id !== undefined
					? `chat ${ config.chat_id }`
					: 'any chat authorized by the bearer';
			process.stdout.write( `Remote session attached → ${ target }.\nPress Ctrl-C to detach.\n` );
		},
	} );

	const signalCleanup: Array< () => void > = [];
	const installSignal = ( signal: NodeJS.Signals ) => {
		const handler = () => {
			logger.info( 'Signal received; detaching', { signal } );
			void detach();
		};
		process.on( signal, handler );
		signalCleanup.push( () => process.off( signal, handler ) );
	};
	installSignal( 'SIGINT' );
	installSignal( 'SIGTERM' );

	const onExit = () => {
		// Best-effort — only fires when chat_id is pinned; otherwise we don't know
		// where to post. Don't block exit.
		if ( config.chat_id === undefined ) {
			return;
		}
		const controller = new AbortController();
		const timer = setTimeout( () => controller.abort(), 2000 );
		void respondMessage(
			config,
			{
				chatId: config.chat_id,
				bot: config.bot,
				text: '🔴 Local agent ended (process exit).',
			},
			{ signal: controller.signal, maxRetries: 0, logger }
		)
			.catch( () => undefined )
			.finally( () => clearTimeout( timer ) );
	};
	process.once( 'beforeExit', onExit );

	try {
		await done;
		if ( ! runningAsDaemon ) {
			process.stdout.write( 'Remote session detached.\n' );
		}
	} finally {
		for ( const cleanup of signalCleanup ) {
			cleanup();
		}
		process.off( 'beforeExit', onExit );
	}
}
