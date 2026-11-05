import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Feedback goes through the WordPress.com MCP server's send-feedback tool, whose
// pipeline stores each report, triages it into Linear and reports its status.
const WPCOM_MCP_URL = new URL( 'https://public-api.wordpress.com/wpcom/v2/mcp/v1' );
const WPCOM_FEEDBACK_TOOL = 'wpcom-mcp-send-feedback';

export const STUDIO_FEEDBACK_TYPES = [ 'bug', 'request', 'general' ] as const;
export type StudioFeedbackType = ( typeof STUDIO_FEEDBACK_TYPES )[ number ];

export interface StudioFeedback {
	type: StudioFeedbackType;
	message: string;
}

export interface StudioFeedbackContext {
	// The WordPress.com OAuth token from `studio auth login`.
	accessToken: string;
	// `WordPressStudio/<version>`: names the client to the server and opens the report.
	userAgent: string;
	platform?: string;
}

interface FeedbackResult {
	status?: string;
	message?: string;
	feedback_id?: number;
}

// Sends one report and returns the ID the service assigned it. Throws when the
// user is not logged in, the message is empty, or the service did not accept
// the report, so nothing reads as sent unless it was.
export async function sendStudioFeedback(
	feedback: StudioFeedback,
	{ accessToken, userAgent, platform = process.platform }: StudioFeedbackContext
): Promise< { feedbackId: number } > {
	const message = feedback.message.trim();
	if ( ! message ) {
		throw new Error( 'Submitting feedback needs a message.' );
	}
	const client = new Client( {
		name: 'wordpress-studio',
		version: userAgent.split( '/' )[ 1 ] ?? 'dev',
	} );
	const transport = new StreamableHTTPClientTransport( WPCOM_MCP_URL, {
		requestInit: {
			headers: { authorization: `Bearer ${ accessToken }`, 'user-agent': userAgent },
		},
	} );
	try {
		await client.connect( transport );
		const result = await client.callTool( {
			name: WPCOM_FEEDBACK_TOOL,
			arguments: {
				action: 'submit',
				type: feedback.type,
				content: `[${ userAgent } on ${ platform }]\n\n${ message }`,
			},
		} );
		const text = ( result.content as { type: string; text?: string }[] | undefined )
			?.map( ( item ) => item.text ?? '' )
			.join( '\n' )
			.trim();
		if ( result.isError ) {
			throw new Error( text || 'the feedback service returned an error' );
		}
		const data = result.structuredContent as FeedbackResult | undefined;
		if ( typeof data?.feedback_id !== 'number' ) {
			throw new Error(
				`the feedback service did not return a feedback ID${ text ? `: ${ text }` : '' }`
			);
		}
		return { feedbackId: data.feedback_id };
	} finally {
		await client.close().catch( () => undefined );
	}
}
