import { AI_BACKEND_PROVIDERS } from '@studio/agent/node/providers';
import { disconnectAiProvider, setAiProvider } from '@studio/agent/node/settings-store';
import { isAiProviderId } from '@studio/agent/protocol/providers';
import { __ } from '@wordpress/i18n';
import { openBrowser } from 'cli/lib/browser';
import { Logger, LoggerError } from 'cli/logger';
import type { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

export const registerCommand = ( yargs: StudioArgv ) =>
	yargs.command( {
		command: 'providers <action> <provider>',
		describe: __( 'Connect or disconnect an AI provider' ),
		builder: ( args ) =>
			args
				.positional( 'action', { choices: [ 'login', 'logout' ] as const, demandOption: true } )
				.positional( 'provider', { type: 'string', demandOption: true } ),
		handler: async ( { action, provider } ) => {
			try {
				if ( ! isAiProviderId( provider ) ) throw new Error( `Unknown AI provider: ${ provider }` );
				if ( action === 'logout' ) {
					await disconnectAiProvider( provider );
					logger.reportSuccess( __( 'Provider disconnected' ) );
					logger.reportResult( { connected: false } );
					return;
				}
				const { auth } = AI_BACKEND_PROVIDERS[ provider ];
				if ( auth.type !== 'oauth' ) {
					throw new Error( 'This provider does not support browser login.' );
				}
				logger.reportStart( 'login', __( 'Waiting for sign-in in your browser…' ) );
				await auth.login( { openUrl: openBrowser } );
				await setAiProvider( provider );
				logger.reportSuccess( __( 'Provider connected' ) );
				logger.reportResult( { connected: true } );
			} catch ( error ) {
				logger.reportError(
					new LoggerError( error instanceof Error ? error.message : String( error ) )
				);
			}
		},
	} );
