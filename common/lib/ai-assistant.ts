import WPCOM from 'wpcom';
import { z } from 'zod';
import { SiteDetails } from 'common/types/sites';

export interface AIContext {
	current_url?: string;
	number_of_sites?: number;
	wp_version?: string;
	php_version?: string;
	plugins?: string[];
	themes?: string[];
	current_theme?: string;
	is_block_theme?: boolean;
	ide?: string[];
	site_name?: string;
	os?: string;
}

export interface AIMessage {
	content: string;
	role: 'user' | 'assistant';
}

export interface AIQuota {
	max_quota: number;
	remaining_quota: number;
	quota_reset_date: string;
	userCanSendMessage: boolean;
	daysUntilReset: number;
}

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
	'x-quota-reset': z.string().datetime( { offset: true } ),
} );

export interface AIResponse {
	content: string;
	messageId: number;
	chatId: number;
	quota: AIQuota;
}

export class AIAssistantError extends Error {
	constructor(
		message: string,
		public cause?: unknown
	) {
		super( message );
		this.name = 'AIAssistantError';
	}
}

/**
 * Ask a question to the AI assistant
 */
export async function askAI(
	question: string,
	context: AIContext,
	accessToken: string,
	chatId?: number
): Promise< AIResponse > {
	const client = new WPCOM( accessToken );

	const messages: AIMessage[] = [
		{
			content: question,
			role: 'user',
		},
	];

	try {
		const { data, headers } = await new Promise< {
			data: z.infer< typeof assistantResponseSchema >;
			headers: z.infer< typeof assistantHeadersSchema >;
		} >( ( resolve, reject ) => {
			client.req.post(
				{
					path: '/studio-app/ai-assistant/chat',
					apiNamespace: 'wpcom/v2',
					body: {
						messages,
						chat_id: chatId,
						context,
					},
				},
				( error, data, headers ) => {
					if ( error ) {
						return reject( new AIAssistantError( 'Failed to get AI response', error ) );
					}

					try {
						const validatedData = assistantResponseSchema.parse( data );
						const validatedHeaders = assistantHeadersSchema.parse( headers );
						return resolve( { data: validatedData, headers: validatedHeaders } );
					} catch ( validationError ) {
						return reject( new AIAssistantError( 'Invalid API response format', validationError ) );
					}
				}
			);
		} );

		// Calculate days until reset
		const resetDate = new Date( headers[ 'x-quota-reset' ] );
		const now = new Date();
		const daysUntilReset = Math.ceil(
			( resetDate.getTime() - now.getTime() ) / ( 1000 * 60 * 60 * 24 )
		);

		const quota: AIQuota = {
			max_quota: headers[ 'x-quota-max' ],
			remaining_quota: headers[ 'x-quota-remaining' ],
			quota_reset_date: headers[ 'x-quota-reset' ],
			userCanSendMessage: headers[ 'x-quota-remaining' ] > 0,
			daysUntilReset: Math.max( 0, daysUntilReset ),
		};

		return {
			content: data.choices[ 0 ].message.content,
			messageId: data.choices[ 0 ].message.id,
			chatId: data.id,
			quota,
		};
	} catch ( error ) {
		if ( error instanceof AIAssistantError ) {
			throw error;
		}
		throw new AIAssistantError( 'Unexpected error occurred', error );
	}
}

/**
 * Get basic context information for AI assistant
 */
export function getBasicContext( siteDetails: SiteDetails ): AIContext {
	const context: AIContext = {
		site_name: siteDetails.name,
		os: process.platform,
		number_of_sites: 1,
		php_version: siteDetails.phpVersion,
		current_url: siteDetails.url || `http://localhost:${ siteDetails.port || '8080' }`,
	};

	return context;
}
