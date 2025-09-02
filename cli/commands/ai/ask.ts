import { __, sprintf } from '@wordpress/i18n';
import { askAI, getBasicContext, AIAssistantError } from 'common/lib/ai-assistant';
import { SiteDetails } from 'common/types/sites';
import { getAuthToken, getSiteByFolder } from 'cli/lib/appdata';
import { LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand( question: string, sitePath: string ): Promise< void > {
	try {
		// Get authentication token
		const authToken = await getAuthToken();

		// Try to get site information, fall back to basic context
		const siteDetails: SiteDetails = await getSiteByFolder( sitePath );
		const context = getBasicContext( siteDetails );

		const response = await askAI( question, context, authToken.accessToken );
		console.log( '\n' + response.content + '\n' );

		const quotaMessage = response.quota.userCanSendMessage
			? sprintf(
					__( 'Remaining prompts: %d/%d' ),
					response.quota.remaining_quota,
					response.quota.max_quota
			  )
			: response.quota.daysUntilReset <= 0
			? __( "You've reached your usage limit for this month. Your limit will reset today." )
			: sprintf(
					__( "You've reached your usage limit for this month. Your limit will reset in %d days." ),
					response.quota.daysUntilReset
			  );

		console.log( `ℹ ${ quotaMessage }\n` );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}

		if ( error instanceof AIAssistantError ) {
			throw new LoggerError( __( 'AI Assistant Error: %s', error.message ), error.cause );
		}

		throw new LoggerError( __( 'Failed to get AI response' ), error );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'ask <question>',
		describe: __( 'Ask a question to the AI assistant' ),
		builder: ( yargs ) => {
			return yargs.positional( 'question', {
				describe: __( 'The question to ask the AI assistant' ),
				type: 'string',
				demandOption: true,
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.question as string, argv.path );
		},
	} );
};
