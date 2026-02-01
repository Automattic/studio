import { input } from '@inquirer/prompts';
import { __, sprintf } from '@wordpress/i18n';
import wpcomFactory from 'src/lib/wpcom-factory';
import wpcomXhrRequest from 'src/lib/wpcom-xhr-request-factory';
import { z } from 'zod';
import { getAuthToken } from 'cli/lib/appdata';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

// Response schemas matching the desktop app implementation
const assistantResponseSchema = z.object( {
	choices: z.array(
		z.object( {
			index: z.number(),
			message: z.object( {
				content: z.string(),
				id: z.number(),
				role: z.string(),
			} ),
		} )
	),
	created_at: z.string(),
	id: z.number(),
} );

const assistantHeadersSchema = z.object( {
	'x-quota-max': z.coerce.number(),
	'x-quota-remaining': z.coerce.number(),
	'x-quota-reset': z.string(),
} );

type AssistantResponse = z.infer< typeof assistantResponseSchema >;
type AssistantHeaders = z.infer< typeof assistantHeadersSchema >;

type ChatMessage = {
	role: 'user' | 'assistant';
	content: string;
};

async function sendChatMessage(
	token: string,
	messages: ChatMessage[],
	chatId?: number
): Promise< { response: AssistantResponse; headers: AssistantHeaders } > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	return new Promise( ( resolve, reject ) => {
		wpcom.req.post(
			{
				path: '/studio-app/ai-assistant/chat',
				apiNamespace: 'wpcom/v2',
				body: {
					messages,
					chat_id: chatId,
					context: {
						current_url: '',
						number_of_sites: 0,
						wp_version: '',
						php_version: '',
						plugins: [],
						themes: [],
						current_theme: '',
						is_block_theme: false,
						ide: [],
						site_name: '',
						os: process.platform,
					},
				},
			},
			( error: Error | null, data: unknown, headers: unknown ) => {
				if ( error ) {
					return reject( error );
				}

				try {
					const validatedData = assistantResponseSchema.parse( data );
					const validatedHeaders = assistantHeadersSchema.parse( headers );
					resolve( { response: validatedData, headers: validatedHeaders } );
				} catch ( validationError ) {
					reject( validationError );
				}
			}
		);
	} );
}

function displayQuotaInfo( headers: AssistantHeaders ) {
	const remaining = headers[ 'x-quota-remaining' ];
	const max = headers[ 'x-quota-max' ];
	const used = max - remaining;

	console.log(
		sprintf(
			__( 'Usage: %d/%d prompts used. Resets on %s' ),
			used,
			max,
			new Date( headers[ 'x-quota-reset' ] ).toLocaleDateString()
		)
	);
}

async function runInteractiveMode( token: string ): Promise< void > {
	const messages: ChatMessage[] = [];
	let chatId: number | undefined;

	console.log( __( 'Interactive chat mode. Type "exit" or "quit" to end the session.\n' ) );

	while ( true ) {
		let userMessage: string;

		try {
			userMessage = await input( {
				message: __( 'You:' ),
			} );
		} catch ( error ) {
			// Handle Ctrl+C
			console.log( __( '\nExiting chat…' ) );
			break;
		}

		// Check for exit commands
		if (
			! userMessage ||
			userMessage.toLowerCase() === 'exit' ||
			userMessage.toLowerCase() === 'quit'
		) {
			console.log( __( 'Exiting chat…' ) );
			break;
		}

		// Add user message to history
		messages.push( {
			role: 'user',
			content: userMessage,
		} );

		const logger = new Logger();
		logger.reportStart( undefined, __( 'Thinking…' ) );

		try {
			const { response, headers } = await sendChatMessage( token, messages, chatId );

			// Update chatId from first response
			if ( ! chatId ) {
				chatId = response.id;
			}

			// Stop the spinner
			logger.spinner.stop();

			// Display the assistant's response
			const assistantMessage = response.choices[ 0 ].message.content;
			console.log( __( 'Assistant:' ), assistantMessage + '\n' );

			// Add assistant message to history
			messages.push( {
				role: 'assistant',
				content: assistantMessage,
			} );

			// Display quota (less prominently in interactive mode)
			displayQuotaInfo( headers );
			console.log( '' ); // Empty line for spacing
		} catch ( error ) {
			logger.spinner.stop();
			if ( error instanceof LoggerError ) {
				logger.reportError( error, false );
			} else if ( error instanceof z.ZodError ) {
				logger.reportError( new LoggerError( __( 'Invalid response from server' ), error ), false );
			} else {
				logger.reportError( new LoggerError( __( 'Failed to send message' ), error ), false );
			}
			console.log( '' ); // Empty line for spacing
		}
	}
}

async function runSingleShotMode( token: string, message: string ): Promise< void > {
	const logger = new Logger();

	logger.reportStart( undefined, __( 'Sending message to WordPress AI…' ) );

	try {
		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: message,
			},
		];

		const { response, headers } = await sendChatMessage( token, messages );

		// Stop the spinner before displaying the response
		logger.spinner.stop();

		// Display the assistant's response
		const assistantMessage = response.choices[ 0 ].message.content;
		console.log( '\n' + assistantMessage + '\n' );

		// Display quota information
		const remaining = headers[ 'x-quota-remaining' ];
		const max = headers[ 'x-quota-max' ];
		const used = max - remaining;

		logger.reportSuccess(
			sprintf(
				__( 'Usage: %d/%d prompts used. Resets on %s' ),
				used,
				max,
				new Date( headers[ 'x-quota-reset' ] ).toLocaleDateString()
			)
		);
	} catch ( error ) {
		logger.spinner.stop();
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else if ( error instanceof z.ZodError ) {
			logger.reportError( new LoggerError( __( 'Invalid response from server' ), error ) );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to send message' ), error ) );
		}
	}
}

export async function runCommand( message?: string ): Promise< void > {
	const logger = new Logger();

	// Check authentication
	let token: Awaited< ReturnType< typeof getAuthToken > >;
	try {
		token = await getAuthToken();
	} catch ( error ) {
		logger.reportError(
			new LoggerError(
				__(
					'Authentication required. Please log in to WordPress.com first:\n\n  studio auth login'
				)
			)
		);
		return;
	}

	// Run appropriate mode
	if ( message ) {
		await runSingleShotMode( token.accessToken, message );
	} else {
		await runInteractiveMode( token.accessToken );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'chat [message]',
		describe: __( 'Chat with WordPress AI assistant' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'message', {
					describe: __(
						'Message to send to the AI assistant. If not provided, enters interactive mode.'
					),
					type: 'string',
				} )
				.option( 'path', {
					hidden: true,
				} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.message as string | undefined );
		},
	} );
};
