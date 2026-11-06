import { signInWithChatGpt } from '@studio/agent/node/chatgpt-auth';
import { __, sprintf } from '@wordpress/i18n';
import { openBrowser } from 'cli/lib/browser';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

/**
 * Signs in with ChatGPT in the browser. The apps run this command to sign in
 * (see `@studio/common/lib/chatgpt-sign-in`), since pi ships only with the
 * CLI; it reports `{ signedIn: true }` once the user finishes.
 */
export async function runCommand(): Promise< void > {
	logger.reportStart( 'login', __( 'Waiting for you to sign in with ChatGPT in your browser…' ) );
	await signInWithChatGpt( {
		openUrl: async ( url ) => {
			logger.reportProgress(
				sprintf(
					/* translators: %s: sign-in page URL */
					__( 'Waiting for you to sign in with ChatGPT. If your browser didn’t open, visit: %s' ),
					url
				)
			);
			await openBrowser( url ).catch( () => {} );
		},
	} );
	logger.reportSuccess( __( 'Signed in with ChatGPT' ) );
	logger.reportResult( { signedIn: true } );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'login',
		describe: __( 'Sign in with ChatGPT to use your Plus or Pro plan' ),
		handler: async () => {
			try {
				await runCommand();
			} catch ( error ) {
				logger.reportError(
					error instanceof LoggerError
						? error
						: new LoggerError( error instanceof Error ? error.message : String( error ) )
				);
			}
		},
	} );
};
