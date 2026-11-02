import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { REPORT_ISSUE_URL } from '@studio/common/lib/docs-links';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { Type } from 'typebox';
import { defineTool, REMOTE_CHANGE } from './define-tool';
import { textResult } from './utils';

// Feedback goes through the WordPress.com MCP server's send-feedback tool, whose
// pipeline stores each report, triages it into Linear and reports its status.
const WPCOM_MCP_URL = new URL( 'https://public-api.wordpress.com/wpcom/v2/mcp/v1' );
const WPCOM_FEEDBACK_TOOL = 'wpcom-mcp-send-feedback';

interface FeedbackResult {
	status?: string;
	message?: string;
	feedback_id?: number;
}

async function submitFeedback(
	accessToken: string,
	userAgent: string,
	feedback: { type: string; content: string }
) {
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
			arguments: { action: 'submit', ...feedback },
		} );
		return result;
	} finally {
		await transport.terminateSession().catch( () => undefined );
		await client.close().catch( () => undefined );
	}
}

export const sendFeedbackTool = defineTool(
	'send_feedback',
	'Sends feedback about WordPress Studio to the Studio team at Automattic. ' +
		'Only send feedback the user asked to send. When a Studio tool fails in a way you cannot work around, or the user is frustrated with Studio, you may offer once to send feedback; ' +
		'send it only if they agree. Before sending, show the user the exact message and wait for their OK. ' +
		'Write it in plain language: what the user was trying to do, what happened, what they expected, and the Studio tool and error message when there is one. ' +
		'Leave out passwords, API keys, tokens and private site content unless the user asks to include them. ' +
		'The message is sent with a line naming the Studio version and operating system. Requires the user to be logged in with `studio auth login`. ' +
		'Submitting returns a feedback ID.',
	{
		type: Type.Enum( [ 'bug', 'request', 'general' ], {
			description:
				'"bug" for something broken, "request" for a feature or improvement, "general" for anything else, including praise.',
		} ),
		message: Type.String( {
			description: 'The feedback, as the user approved it. Plain text.',
		} ),
	},
	async ( args, context ) => {
		const token = await readAuthToken();
		if ( ! token?.accessToken ) {
			throw new Error(
				`Not logged in to WordPress.com. Ask the user to log in with \`studio auth login\`, or to share feedback at ${ REPORT_ISSUE_URL }.`
			);
		}
		const message = args.message.trim();
		if ( ! message ) {
			throw new Error( 'Submitting feedback needs a message.' );
		}
		const { userAgent } = context.host;
		try {
			const result = await submitFeedback( token.accessToken, userAgent, {
				type: args.type,
				content: `[${ userAgent } on ${ process.platform }]\n\n${ message }`,
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
			return textResult( `Feedback sent. Feedback ID: ${ data.feedback_id }.` );
		} catch ( error ) {
			throw new Error(
				`Failed to send feedback: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{
		promptSnippet: 'Send the user’s feedback about Studio to the Studio team.',
		annotations: REMOTE_CHANGE,
	}
);
