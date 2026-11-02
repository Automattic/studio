import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindTool } from '@studio/agent/node/tools/define-tool';
import { sendFeedbackTool } from '@studio/agent/node/tools/send-feedback';
import { createFakeHost } from './fake-host';

const sendFeedback = bindTool( sendFeedbackTool, createFakeHost() );

const mocks = vi.hoisted( () => ( { readAuthToken: vi.fn() } ) );

vi.mock( '@studio/common/lib/shared-config', () => ( {
	readAuthToken: mocks.readAuthToken,
} ) );

interface JsonRpcMessage {
	id?: number;
	method?: string;
	params?: { name: string; arguments: Record< string, unknown > };
}

interface SeenRequest {
	httpMethod: string;
	headers: Headers;
	message?: JsonRpcMessage;
}

const json = ( body: unknown, headers: Record< string, string > = {} ) =>
	new Response( JSON.stringify( body ), {
		headers: { 'content-type': 'application/json', ...headers },
	} );

// A minimal streamable-HTTP MCP server, as the WordPress.com one behaves: it
// hands out a session on initialize, offers no GET stream, and answers each
// tools/call with `respond`.
function fakeServer( respond: ( message: JsonRpcMessage ) => Response ) {
	const seen: SeenRequest[] = [];
	const fetchMock = vi.fn( async ( _url: URL, init: RequestInit = {} ) => {
		const httpMethod = init.method ?? 'GET';
		const headers = new Headers( init.headers );
		const message =
			httpMethod === 'POST' ? ( JSON.parse( init.body as string ) as JsonRpcMessage ) : undefined;
		seen.push( { httpMethod, headers, message } );
		if ( httpMethod === 'GET' ) return new Response( null, { status: 405 } );
		if ( httpMethod === 'DELETE' ) return new Response( null, { status: 200 } );
		if ( message?.method === 'initialize' ) {
			return json(
				{
					jsonrpc: '2.0',
					id: message.id,
					result: {
						protocolVersion: '2025-06-18',
						capabilities: { tools: {} },
						serverInfo: { name: 'WordPress.com MCP Server', version: '0.2.0' },
					},
				},
				{ 'mcp-session-id': 'session-1' }
			);
		}
		if ( message?.id === undefined ) return new Response( null, { status: 202 } );
		return respond( message );
	} );
	vi.stubGlobal( 'fetch', fetchMock );
	return { seen, fetchMock };
}

const toolCallResult = ( message: JsonRpcMessage, result: unknown ) =>
	json( { jsonrpc: '2.0', id: message.id, result } );

describe( 'send_feedback', () => {
	beforeEach( () => {
		vi.resetAllMocks();
		mocks.readAuthToken.mockResolvedValue( { accessToken: 'token' } );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'submits the feedback through the WordPress.com feedback tool, naming Studio', async () => {
		const { seen } = fakeServer( ( message ) =>
			toolCallResult( message, {
				content: [ { type: 'text', text: 'Thanks!' } ],
				structuredContent: { status: 'success', message: 'Thanks!', feedback_id: 42 },
			} )
		);

		const result = await sendFeedback.rawHandler( {
			type: 'bug',
			message: 'The preview did not reload after a theme change.',
		} );

		expect( result.content[ 0 ] ).toEqual( {
			type: 'text',
			text: 'Feedback sent. Feedback ID: 42.',
		} );
		expect( seen.map( ( r ) => r.message?.method ?? r.httpMethod ) ).toEqual( [
			'initialize',
			'notifications/initialized',
			'GET',
			'tools/call',
			'DELETE',
		] );
		const call = seen.find( ( r ) => r.message?.method === 'tools/call' )!;
		expect( call.headers.get( 'authorization' ) ).toBe( 'Bearer token' );
		expect( call.headers.get( 'user-agent' ) ).toBe( 'WordPressStudio/test' );
		expect( call.headers.get( 'mcp-session-id' ) ).toBe( 'session-1' );
		expect( call.headers.get( 'mcp-protocol-version' ) ).toBe( '2025-06-18' );
		expect( call.message?.params ).toEqual( {
			name: 'wpcom-mcp-send-feedback',
			arguments: {
				action: 'submit',
				type: 'bug',
				content: `[WordPressStudio/test on ${ process.platform }]\n\nThe preview did not reload after a theme change.`,
			},
		} );
	} );

	it( 'reads a result streamed as server-sent events after a notification', async () => {
		fakeServer( ( message ) => {
			const events = [
				{
					jsonrpc: '2.0',
					method: 'notifications/message',
					params: { level: 'info', data: 'Storing.' },
				},
				{
					jsonrpc: '2.0',
					id: message.id,
					result: { content: [], structuredContent: { feedback_id: 7 } },
				},
			];
			return new Response(
				events
					.map( ( event ) => `event: message\ndata: ${ JSON.stringify( event ) }\n\n` )
					.join( '' ),
				{ headers: { 'content-type': 'text/event-stream' } }
			);
		} );

		const result = await sendFeedback.rawHandler( { type: 'general', message: 'Love it.' } );

		expect( result.content[ 0 ] ).toEqual( {
			type: 'text',
			text: 'Feedback sent. Feedback ID: 7.',
		} );
	} );

	it( 'fails when the feedback service reports an error', async () => {
		fakeServer( ( message ) =>
			toolCallResult( message, {
				isError: true,
				content: [ { type: 'text', text: 'Rate limited.' } ],
			} )
		);

		await expect(
			sendFeedback.rawHandler( { type: 'request', message: 'Add a dark theme.' } )
		).rejects.toThrow( 'Failed to send feedback: Rate limited.' );
	} );

	it( 'fails when no feedback ID comes back, so nothing reads as sent', async () => {
		fakeServer( ( message ) =>
			toolCallResult( message, {
				content: [ { type: 'text', text: 'Queued for review.' } ],
				structuredContent: { status: 'queued', message: 'Queued for review.' },
			} )
		);

		await expect(
			sendFeedback.rawHandler( { type: 'bug', message: 'It broke.' } )
		).rejects.toThrow(
			'Failed to send feedback: the feedback service did not return a feedback ID: Queued for review.'
		);
	} );

	it( 'asks the user to log in when there is no WordPress.com token', async () => {
		const { fetchMock } = fakeServer( () => json( {} ) );
		mocks.readAuthToken.mockResolvedValue( null );

		await expect(
			sendFeedback.rawHandler( { type: 'bug', message: 'Something broke.' } )
		).rejects.toThrow( /studio auth login.*github\.com\/Automattic\/studio\/issues/ );
		expect( fetchMock ).not.toHaveBeenCalled();
	} );

	it( 'needs a message to submit', async () => {
		const { fetchMock } = fakeServer( () => json( {} ) );

		await expect( sendFeedback.rawHandler( { type: 'bug', message: '  ' } ) ).rejects.toThrow(
			'needs a message'
		);
		expect( fetchMock ).not.toHaveBeenCalled();
	} );
} );
