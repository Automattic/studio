import { sendStudioFeedback } from '@studio/common/lib/feedback';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindTool } from '@studio/agent/shared/tools/define-tool';
import { sendFeedbackTool } from '@studio/agent/shared/tools/send-feedback';
import { createFakeHost } from './fake-host';

const host = {
	...createFakeHost(),
	sendFeedback: ( feedback: Parameters< typeof sendStudioFeedback >[ 0 ], accessToken: string ) =>
		sendStudioFeedback( feedback, { accessToken, userAgent: 'WordPressStudio/test' } ),
};
const sendFeedback = bindTool( sendFeedbackTool, host );

const mocks = vi.hoisted( () => ( {
	transport: vi.fn(),
	connect: vi.fn(),
	callTool: vi.fn(),
	close: vi.fn(),
} ) );

vi.mock( '@modelcontextprotocol/sdk/client/index.js', () => ( {
	Client: class {
		connect = mocks.connect;
		callTool = mocks.callTool;
		close = mocks.close;
	},
} ) );
vi.mock( '@modelcontextprotocol/sdk/client/streamableHttp.js', () => ( {
	StreamableHTTPClientTransport: class {
		constructor( url: URL, options: unknown ) {
			mocks.transport( url.toString(), options );
		}
	},
} ) );

describe( 'send_feedback', () => {
	beforeEach( () => {
		vi.resetAllMocks();
		vi.mocked( host.wpcom.token ).mockResolvedValue( 'token' );
		mocks.connect.mockResolvedValue( undefined );
		mocks.close.mockResolvedValue( undefined );
	} );

	it( 'submits the feedback through the WordPress.com feedback tool, naming Studio', async () => {
		mocks.callTool.mockResolvedValue( {
			content: [ { type: 'text', text: 'Thanks!' } ],
			structuredContent: { status: 'success', message: 'Thanks!', feedback_id: 42 },
		} );

		const result = await sendFeedback.rawHandler( {
			type: 'bug',
			message: 'The preview did not reload after a theme change.',
		} );

		expect( result.content[ 0 ] ).toEqual( {
			type: 'text',
			text: 'Feedback sent. Feedback ID: 42.',
		} );
		expect( mocks.transport ).toHaveBeenCalledWith(
			'https://public-api.wordpress.com/wpcom/v2/mcp/v1',
			{
				requestInit: {
					headers: { authorization: 'Bearer token', 'user-agent': 'WordPressStudio/test' },
				},
			}
		);
		expect( mocks.callTool ).toHaveBeenCalledWith( {
			name: 'wpcom-mcp-send-feedback',
			arguments: {
				action: 'submit',
				type: 'bug',
				content: `[WordPressStudio/test on ${ process.platform }]\n\nThe preview did not reload after a theme change.`,
			},
		} );
		expect( mocks.close ).toHaveBeenCalled();
	} );

	it( 'fails when the feedback service reports an error', async () => {
		mocks.callTool.mockResolvedValue( {
			isError: true,
			content: [ { type: 'text', text: 'Rate limited.' } ],
		} );

		await expect(
			sendFeedback.rawHandler( { type: 'request', message: 'Add a dark theme.' } )
		).rejects.toThrow( 'Failed to send feedback: Rate limited.' );
		expect( mocks.close ).toHaveBeenCalled();
	} );

	it( 'reads the feedback ID from the text when the structured result lacks it', async () => {
		mocks.callTool.mockResolvedValue( {
			content: [
				{ type: 'text', text: 'Thanks! The team received your feedback (reference ID 1018).' },
			],
		} );

		const result = await sendFeedback.rawHandler( { type: 'bug', message: 'It broke.' } );

		expect( result.content[ 0 ] ).toEqual( {
			type: 'text',
			text: 'Feedback sent. Feedback ID: 1018.',
		} );
	} );

	it( 'fails when no feedback ID comes back, saying the report may still have arrived', async () => {
		mocks.callTool.mockResolvedValue( {
			content: [ { type: 'text', text: 'Queued for review.' } ],
			structuredContent: { status: 'queued', message: 'Queued for review.' },
		} );

		await expect(
			sendFeedback.rawHandler( { type: 'bug', message: 'It broke.' } )
		).rejects.toThrow(
			'Failed to send feedback: the feedback service did not confirm a feedback ID, so the report may or may not have been received: Queued for review.'
		);
	} );

	it( 'asks the user to log in when there is no WordPress.com token', async () => {
		vi.mocked( host.wpcom.token ).mockResolvedValue( undefined );

		await expect(
			sendFeedback.rawHandler( { type: 'bug', message: 'Something broke.' } )
		).rejects.toThrow( /studio auth login.*github\.com\/Automattic\/studio\/issues/ );
		expect( mocks.connect ).not.toHaveBeenCalled();
	} );
} );
