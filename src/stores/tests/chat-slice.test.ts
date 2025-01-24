import WPCOM from 'wpcom';
import { CHAT_ID_STORE_KEY, CHAT_MESSAGES_STORE_KEY } from 'src/constants';
import store from 'src/stores';
import {
	fetchAssistantThunk,
	generateMessage,
	resetChatState,
	sendFeedbackThunk,
	setMessages,
} from 'src/stores/chat-slice';

const mockClientReqPostUsingCallback = jest.fn().mockImplementation( ( params, callback ) => {
	callback(
		null,
		{
			id: 'chatcmpl-123',
			choices: [
				{
					message: {
						id: 42,
						content: 'Test assistant response',
					},
				},
			],
		},
		{
			'x-quota-max': '100',
			'x-quota-remaining': '99',
		}
	);
} );

const mockClientUsingCallback = {
	req: { post: mockClientReqPostUsingCallback },
} as unknown as WPCOM;

const mockClientReqPostUsingPromise = jest.fn().mockResolvedValue( {
	data: 'success',
} );

const mockClientUsingPromise = {
	req: { post: mockClientReqPostUsingPromise },
} as unknown as WPCOM;

describe( 'chat-slice', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		localStorage.clear();
		store.dispatch( resetChatState() );
	} );

	describe( 'fetchAssistantThunk', () => {
		it( 'should add assistant message to state when fulfilled', async () => {
			const instanceId = 'test-site';
			const userMessage = generateMessage( 'Hello test 1', 'user', 0, 'chatcmpl-123', 42 );

			const result = await store.dispatch(
				fetchAssistantThunk( {
					client: mockClientUsingCallback,
					instanceId,
					message: userMessage,
					siteId: instanceId,
				} )
			);

			expect( result.type ).toBe( 'chat/fetchAssistant/fulfilled' );
			expect( result.payload ).toEqual( {
				chatApiId: 'chatcmpl-123',
				maxQuota: '100',
				message: 'Test assistant response',
				messageApiId: 42,
				remainingQuota: '99',
			} );

			const state = store.getState();
			const messages = state.chat.messagesDict[ instanceId ];

			expect( messages ).toHaveLength( 2 );
			expect( messages[ 0 ] ).toEqual( userMessage );
			expect( messages[ 1 ] ).toMatchObject( {
				content: 'Test assistant response',
				role: 'assistant',
				chatApiId: 'chatcmpl-123',
				messageApiId: 42,
			} );

			expect( state.chat.promptUsageDict[ instanceId ] ).toEqual( {
				maxQuota: '100',
				remainingQuota: '99',
			} );
		} );

		it( 'should mark message as failed when rejected', async () => {
			const instanceId = 'test-site';
			const userMessage = generateMessage( 'Hello test 2', 'user', 0, 'chatcmpl-123', 42 );

			mockClientReqPostUsingCallback.mockImplementationOnce( ( params, callback ) => {
				callback( new Error( 'API Error' ), null, {} );
			} );

			const result = await store.dispatch(
				fetchAssistantThunk( {
					client: mockClientUsingCallback,
					instanceId,
					message: userMessage,
					siteId: instanceId,
				} )
			);

			expect( result.type ).toBe( 'chat/fetchAssistant/rejected' );

			const state = store.getState();
			const messages = state.chat.messagesDict[ instanceId ];

			expect( messages ).toHaveLength( 1 );
			expect( messages[ 0 ] ).toMatchObject( {
				...userMessage,
				failedMessage: true,
			} );
		} );
	} );

	describe( 'sendFeedbackThunk', () => {
		it( 'should mark message as feedback received', async () => {
			const instanceId = 'test-site';

			const userMessage = generateMessage( 'Hello test 3', 'user', 0, 'chatcmpl-123', 42 );
			const assistantMessage = generateMessage( 'Response', 'assistant', 1, 'chatcmpl-123', 43 );
			store.dispatch( setMessages( { instanceId, messages: [ userMessage, assistantMessage ] } ) );

			const result = await store.dispatch(
				sendFeedbackThunk( {
					client: mockClientUsingPromise,
					instanceId,
					messageApiId: 42,
					ratingValue: 1,
				} )
			);

			expect( result.type ).toBe( 'chat/sendFeedback/fulfilled' );

			const state = store.getState();
			console.log( 'state', state );
			const messages = state.chat.messagesDict[ instanceId ];

			expect( messages[ 0 ].feedbackReceived ).toBe( true );
		} );
	} );

	describe( 'localStorage persistence', () => {
		it( 'should persist messagesDict and chatApiIdDict changes to localStorage', async () => {
			const instanceId = 'test-site';
			const userMessage = generateMessage( 'Hello test 4', 'user', 0, 'chatcmpl-123', 42 );

			await store.dispatch(
				fetchAssistantThunk( {
					client: mockClientUsingCallback,
					instanceId,
					message: userMessage,
					siteId: instanceId,
				} )
			);

			const storedMessages = JSON.parse( localStorage.getItem( CHAT_MESSAGES_STORE_KEY ) || '{}' );
			expect( storedMessages[ instanceId ] ).toHaveLength( 2 );
			expect( storedMessages[ instanceId ][ 0 ] ).toEqual( userMessage );
			expect( storedMessages[ instanceId ][ 1 ] ).toMatchObject( {
				content: 'Test assistant response',
				role: 'assistant',
			} );

			const storedChatIds = JSON.parse( localStorage.getItem( CHAT_ID_STORE_KEY ) || '{}' );
			expect( storedChatIds[ instanceId ] ).toBe( 'chatcmpl-123' );
		} );
	} );
} );
