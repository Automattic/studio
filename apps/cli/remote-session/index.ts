import { getRemoteSessionLogPath } from '@studio/common/lib/well-known-paths';
import {
	RemoteSessionConfigError,
	loadRemoteSessionConfig,
	type RemoteSessionOverrides,
} from 'cli/remote-session/config';
import { RemoteSessionLogger } from 'cli/remote-session/logger';
import { runPollLoop } from 'cli/remote-session/poll-loop';
import { respondMessage } from 'cli/remote-session/telegram-client';

export { RemoteSessionConfigError };

/**
 * Entry point for the --remote-session flag AND for the /remote-session attach
 * slash command. Validates config, enters the poll loop, and returns when the
 * loop exits (detach, Ctrl-C, or fatal error).
 */
export async function runRemoteSession( overrides: RemoteSessionOverrides = {} ): Promise< void > {
	const config = await loadRemoteSessionConfig( overrides );
	const logger = new RemoteSessionLogger();
	const logPath = getRemoteSessionLogPath();
	logger.info( 'Remote session starting', {
		base_url: config.base_url,
		has_chat_id: config.chat_id !== undefined,
		bot: config.bot,
		poll_interval_seconds: config.poll_interval_seconds,
		long_poll_timeout_seconds: config.long_poll_timeout_seconds,
		turn_timeout_seconds: config.turn_timeout_seconds,
		debug: process.env.STUDIO_REMOTE_DEBUG === '1',
	} );
	process.stdout.write( `Remote session log: ${ logPath }\n` );

	const { done, detach } = await runPollLoop( {
		config,
		deps: { logger },
		onAttached: () => {
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
		process.stdout.write( 'Remote session detached.\n' );
	} finally {
		for ( const cleanup of signalCleanup ) {
			cleanup();
		}
		process.off( 'beforeExit', onExit );
	}
}
