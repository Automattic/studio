import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindTool } from '@studio/agent/node/tools/define-tool';
import { sendFeedbackTool } from '@studio/agent/node/tools/send-feedback';
import { createFakeHost } from './fake-host';

const sendFeedback = bindTool( sendFeedbackTool, createFakeHost() );

const mocks = vi.hoisted( () => ( { readAuthToken: vi.fn() } ) );

vi.mock( '@studio/common/lib/shared-config', () => ( {
	readAuthToken: mocks.readAuthToken,
} ) );

function jsonRpc( result: unknown, headers: Record< string, string > = {} ) {
	return new Response( JSON.stringify( { jsonrpc: '2.0', id: 1, result } ), {
		headers: { 'content-type': 'application/json', ...headers },
	} );
}

function requestBody( call: unknown[] ) {
	return JSON.parse( ( call[ 1 ] as RequestInit ).body as string );
}

describe( 'send_feedback', () => {
	const fetchMock = vi.fn();

	beforeEach( () => {
		vi.resetAllMocks();
		vi.stubGlobal( 'fetch', fetchMock );
		mocks.readAuthToken.mockResolvedValue( { accessToken: 'token' } );
		fetchMock.mockResolvedValueOnce( jsonRpc( {}, { 'mcp-session-id': 'session-1' } ) );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'submits the feedback through the WordPress.com feedback tool, naming Studio', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonRpc( {
				content: [ { type: 'text', text: 'Thanks!' } ],
				structuredContent: { status: 'success', message: 'Thanks!', feedback_id: 42 },
			} )
		);

		const result = await sendFeedback.rawHandler( {
			type: 'bug',
			message: 'The preview did not reload after a theme change.',
		} );

		expect( requestBody( fetchMock.mock.calls[ 0 ] ).method ).toBe( 'initialize' );
		const [ url, init ] = fetchMock.mock.calls[ 1 ];
		expect( url ).toBe( 'https://public-api.wordpress.com/wpcom/v2/mcp/v1' );
		expect( init.headers ).toMatchObject( {
			authorization: 'Bearer token',
			'mcp-session-id': 'session-1',
		} );
		expect( requestBody( fetchMock.mock.calls[ 1 ] ).params ).toEqual( {
			name: 'wpcom-mcp-send-feedback',
			arguments: {
				action: 'submit',
				type: 'bug',
				content: `[WordPress Studio: WordPressStudio/test, ${ process.platform }]\n\nThe preview did not reload after a theme change.`,
			},
		} );
		expect( result.content[ 0 ] ).toEqual( {
			type: 'text',
			text: 'Feedback sent. Feedback ID: 42.',
		} );
	} );

	it( 'reports the status of earlier feedback', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonRpc( { content: [ { type: 'text', text: 'Feedback 42 is tracked.' } ] } )
		);

		const result = await sendFeedback.rawHandler( { action: 'status', feedbackId: 42 } );

		expect( requestBody( fetchMock.mock.calls[ 1 ] ).params.arguments ).toEqual( {
			action: 'status',
			feedback_id: 42,
		} );
		expect( result.content[ 0 ] ).toEqual( { type: 'text', text: 'Feedback 42 is tracked.' } );
	} );

	it( 'reads a response sent as a server-sent event', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				`event: message\ndata: ${ JSON.stringify( {
					jsonrpc: '2.0',
					id: 2,
					result: { content: [], structuredContent: { feedback_id: 7 } },
				} ) }\n\n`,
				{ headers: { 'content-type': 'text/event-stream' } }
			)
		);

		const result = await sendFeedback.rawHandler( { type: 'general', message: 'Love it.' } );

		expect( result.content[ 0 ] ).toEqual( {
			type: 'text',
			text: 'Feedback sent. Feedback ID: 7.',
		} );
	} );

	it( 'fails when the feedback service reports an error', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonRpc( { isError: true, content: [ { type: 'text', text: 'Rate limited.' } ] } )
		);

		await expect(
			sendFeedback.rawHandler( { type: 'request', message: 'Add a dark theme.' } )
		).rejects.toThrow( 'Failed to send feedback: Rate limited.' );
	} );

	it( 'asks the user to log in when there is no WordPress.com token', async () => {
		mocks.readAuthToken.mockResolvedValue( null );

		await expect(
			sendFeedback.rawHandler( { type: 'bug', message: 'Something broke.' } )
		).rejects.toThrow( 'studio auth login' );
		expect( fetchMock ).not.toHaveBeenCalled();
	} );

	it( 'needs a type and a message to submit', async () => {
		await expect( sendFeedback.rawHandler( { type: 'bug', message: '  ' } ) ).rejects.toThrow(
			'needs both a type and a message'
		);
		expect( fetchMock ).not.toHaveBeenCalled();
	} );
} );
