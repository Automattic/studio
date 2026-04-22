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

	const { done, detach } = await runPollLoop( {
		config,
		onAttached: () => {
			process.stdout.write(
				`Remote session attached → chat ${ config.chat_id }.\n` + `Press Ctrl-C to detach.\n`
			);
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
		// Best-effort — don't block exit. 2s timeout built into fetch via abort.
		const controller = new AbortController();
		const timer = setTimeout( () => controller.abort(), 2000 );
		void respondMessage(
			config,
			{ chatId: config.chat_id, text: '🔴 Local agent ended (process exit).' },
			{ signal: controller.signal, maxRetries: 0 }
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
