import { readAuthToken } from '@studio/common/lib/shared-config';
import { Type } from 'typebox';
import { defineTool, REMOTE_CHANGE } from './define-tool';
import { textResult } from './utils';

// Feedback goes through the WordPress.com MCP server's send-feedback tool, whose
// pipeline stores each report, triages it into Linear and reports its status.
const WPCOM_MCP_URL = 'https://public-api.wordpress.com/wpcom/v2/mcp/v1';
const WPCOM_FEEDBACK_TOOL = 'wpcom-mcp-send-feedback';
const MCP_PROTOCOL_VERSION = '2025-06-18';

interface JsonRpcResponse {
	result?: {
		content?: { type: string; text?: string }[];
		structuredContent?: { message?: string; feedback_id?: number; items?: unknown[] };
		isError?: boolean;
	};
	error?: { message: string };
}

// The server answers with JSON or, for streaming clients, a single SSE event.
async function readJsonRpc( response: Response ): Promise< JsonRpcResponse > {
	const body = await response.text();
	if ( ! response.ok ) {
		throw new Error( `HTTP ${ response.status }: ${ body.slice( 0, 300 ) }` );
	}
	const json = response.headers.get( 'content-type' )?.includes( 'text/event-stream' )
		? body
				.split( '\n' )
				.filter( ( line ) => line.startsWith( 'data:' ) )
				.map( ( line ) => line.slice( 5 ).trim() )
				.join( '' )
		: body;
	const parsed = JSON.parse( json ) as JsonRpcResponse;
	if ( parsed.error ) {
		throw new Error( parsed.error.message );
	}
	return parsed;
}

async function callWpcomFeedbackTool(
	accessToken: string,
	userAgent: string,
	args: Record< string, unknown >
) {
	const headers: Record< string, string > = {
		authorization: `Bearer ${ accessToken }`,
		accept: 'application/json, text/event-stream',
		'content-type': 'application/json',
		'user-agent': userAgent,
	};
	const initialize = await fetch( WPCOM_MCP_URL, {
		method: 'POST',
		headers,
		body: JSON.stringify( {
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: MCP_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: 'wordpress-studio', version: userAgent },
			},
		} ),
	} );
	await readJsonRpc( initialize );
	const sessionId = initialize.headers.get( 'mcp-session-id' );
	const call = await fetch( WPCOM_MCP_URL, {
		method: 'POST',
		headers: { ...headers, ...( sessionId ? { 'mcp-session-id': sessionId } : {} ) },
		body: JSON.stringify( {
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/call',
			params: { name: WPCOM_FEEDBACK_TOOL, arguments: args },
		} ),
	} );
	const { result } = await readJsonRpc( call );
	const text =
		result?.content
			?.map( ( item ) => item.text ?? '' )
			.join( '\n' )
			.trim() ?? '';
	if ( result?.isError ) {
		throw new Error( text || 'the feedback service returned an error' );
	}
	return { text, data: result?.structuredContent };
}

export const sendFeedbackTool = defineTool(
	'send_feedback',
	'Sends feedback about WordPress Studio to the Studio team at Automattic, or reports what happened to feedback the user already sent. ' +
		'Only send feedback the user asked to send. When a Studio tool fails in a way you cannot work around, or the user is frustrated with Studio, you may offer once to send feedback; ' +
		'send it only if they agree. Before sending, show the user the exact message and wait for their OK. ' +
		'Write it in plain language: what the user was trying to do, what happened, what they expected, and the Studio tool and error message when there is one. ' +
		'Leave out passwords, API keys, tokens and private site content unless the user asks to include them. ' +
		'The message is sent with a line naming the Studio version and operating system. Requires the user to be logged in with `studio auth login`. ' +
		'Submitting returns a feedback ID; when the user asks what happened to their feedback, call this with action "status".',
	{
		action: Type.Optional(
			Type.Enum( [ 'submit', 'status' ], {
				description:
					'"submit" (default) sends new feedback. "status" reports what happened to the user\'s feedback: one item when feedbackId is given, otherwise their most recent items.',
			} )
		),
		type: Type.Optional(
			Type.Enum( [ 'bug', 'request', 'general' ], {
				description:
					'Required to submit. "bug" for something broken, "request" for a feature or improvement, "general" for anything else, including praise.',
			} )
		),
		message: Type.Optional(
			Type.String( {
				description: 'Required to submit. The feedback, as the user approved it. Plain text.',
			} )
		),
		feedbackId: Type.Optional(
			Type.Number( {
				description: 'With action "status": the feedback ID returned when it was submitted.',
			} )
		),
	},
	async ( args, context ) => {
		const token = await readAuthToken();
		if ( ! token?.accessToken ) {
			throw new Error(
				'Not logged in to WordPress.com. Ask the user to log in with `studio auth login`, or to share feedback at https://github.com/Automattic/studio/issues/new/choose.'
			);
		}
		const { userAgent } = context.host;

		if ( args.action === 'status' ) {
			try {
				const { text } = await callWpcomFeedbackTool( token.accessToken, userAgent, {
					action: 'status',
					...( args.feedbackId !== undefined ? { feedback_id: args.feedbackId } : {} ),
				} );
				return textResult( text );
			} catch ( error ) {
				throw new Error(
					`Failed to check feedback: ${ error instanceof Error ? error.message : String( error ) }`
				);
			}
		}

		const message = args.message?.trim();
		if ( ! args.type || ! message ) {
			throw new Error( 'Submitting feedback needs both a type and a message.' );
		}
		try {
			const { text, data } = await callWpcomFeedbackTool( token.accessToken, userAgent, {
				action: 'submit',
				type: args.type,
				content: `[WordPress Studio: ${ userAgent }, ${ process.platform }]\n\n${ message }`,
			} );
			return textResult(
				data?.feedback_id !== undefined
					? `Feedback sent. Feedback ID: ${ data.feedback_id }.`
					: text || 'Feedback sent.'
			);
		} catch ( error ) {
			throw new Error(
				`Failed to send feedback: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{
		promptSnippet:
			'Send the user’s feedback about Studio to the Studio team, or check what happened to feedback they sent.',
		annotations: REMOTE_CHANGE,
	}
);
