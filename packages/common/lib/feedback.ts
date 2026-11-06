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
	// `WordPressStudio/<version>` (see `getStudioUserAgent`): names the client to
	// the server and opens the report.
	userAgent: string;
	platform?: string;
}

interface FeedbackResult {
	status?: string;
	message?: string;
	feedback_id?: number;
}

// The ID the service assigned: from the structured result, or failing that
// from its text ("Feedback ID: 1018", "reference ID 1018").
function readFeedbackId( data: FeedbackResult | undefined, text: string ): number | undefined {
	if ( typeof data?.feedback_id === 'number' ) {
		return data.feedback_id;
	}
	const match = /\b(?:feedback|reference)\s*ID\b\D{0,10}(\d+)/i.exec( text );
	return match ? Number( match[ 1 ] ) : undefined;
}

// Sends one report and returns the ID the service assigned it. Throws when the
// message is empty or the service did not confirm the report, so nothing reads
// as sent unless it was. A throw after the request went out does not mean the
// report was dropped, so callers report the error rather than retrying.
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
		const text =
			( result.content as { type: string; text?: string }[] | undefined )
				?.map( ( item ) => item.text ?? '' )
				.join( '\n' )
				.trim() ?? '';
		if ( result.isError ) {
			throw new Error( text || 'the feedback service returned an error' );
		}
		const feedbackId = readFeedbackId(
			result.structuredContent as FeedbackResult | undefined,
			text
		);
		if ( feedbackId === undefined ) {
			throw new Error(
				`the feedback service did not confirm a feedback ID, so the report may or may not have been received${
					text ? `: ${ text }` : ''
				}`
			);
		}
		return { feedbackId };
	} finally {
		await client.close().catch( () => undefined );
	}
}
