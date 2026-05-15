import { readAuthToken } from '@studio/common/lib/shared-config';
import { AuthCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getUserInfo } from 'cli/lib/api';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand( format: 'text' | 'json' = 'text' ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	if ( format !== 'json' ) {
		logger.reportStart( LoggerAction.STATUS_CHECK, __( 'Checking authentication status…' ) );
	}

	try {
		const token = await readAuthToken();

		if ( ! token ) {
			if ( format === 'json' ) {
				console.log( JSON.stringify( { authenticated: false }, null, 2 ) );
			} else {
				logger.reportError( new LoggerError( __( 'Authentication token is invalid or expired' ) ) );
			}
			return;
		}

		const userData = await getUserInfo( token.accessToken );

		if ( format === 'json' ) {
			console.log(
				JSON.stringify(
					{
						authenticated: true,
						id: userData.ID,
						username: userData.username,
						email: userData.email,
						displayName: userData.display_name,
					},
					null,
					2
				)
			);
		} else {
			logger.reportSuccess(
				sprintf( __( 'Authenticated with WordPress.com as `%s`' ), userData.username )
			);
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to check authentication status' ), error ) );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'status',
		describe: __( 'Check authentication status' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'path', {
					hidden: true,
				} )
				.option( 'format', {
					type: 'string',
					choices: [ 'text', 'json' ] as const,
					default: 'text' as const,
					description: __( 'Output format' ),
				} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.format );
		},
	} );
};
