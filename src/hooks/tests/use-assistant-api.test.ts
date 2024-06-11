import { renderHook, act } from '@testing-library/react';
import { Message } from '../use-assistant';
import { useAssistantApi } from '../use-assistant-api';
import { useAuth } from '../use-auth';
import { usePromptUsage } from '../use-prompt-usage';

jest.mock( '../use-auth' );
jest.mock( '../use-prompt-usage' );

const chatId = 'test-chat-id';

describe( 'useAssistantApi', () => {
	const clientReqPost = jest.fn();
	beforeEach( () => {
		( usePromptUsage as jest.Mock ).mockImplementation( () => {
			return { updatePromptUsage: jest.fn() };
		} );
		clientReqPost.mockImplementation( ( body, callback ) => {
			callback(
				null,
				{
					id: 'chatcmpl-9USNsuhHWYsPAUNiOhOG2970Hjwwb',
					object: 'chat.completion',
					created: 1717045976,
					model: 'test',
					choices: [
						{
							index: 0,
							message: {
								role: 'assistant',
								content: 'Hello! How can I assist you today?',
							},
							logprobs: null,
							finish_reason: 'stop',
						},
					],
					usage: { prompt_tokens: 980, completion_tokens: 36, total_tokens: 1016 },
					system_fingerprint: 'fp_777',
				},
				{}
			);
		} );
		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
		} ) );
	} );

	test( 'should throw an error if client is not initialized', async () => {
		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: null,
		} ) );
		const { result } = renderHook( () => useAssistantApi() );

		await act( async () => {
			await expect( result.current.fetchAssistant( chatId, {} as Message ) ).rejects.toThrow(
				'WPcom client not initialized'
			);
		} );
	} );

	test( 'should return a message from the assistant', async () => {
		const { result } = renderHook( () => useAssistantApi() );

		let response = { message: '' };
		await act( async () => {
			response = await result.current.fetchAssistant( chatId, { content: 'test', role: 'user' } );
		} );

		expect( response?.message ).toBe( 'Hello! How can I assist you today?' );
	} );

	test( 'should throw an error if fetch fails', async () => {
		const { result } = renderHook( () => useAssistantApi() );

		clientReqPost.mockImplementation( ( body, callback ) => {
			callback( new Error( 'Failed to fetch assistant' ), null );
		} );

		await act( async () => {
			await expect(
				result.current.fetchAssistant( chatId, { content: 'test', role: 'user' } )
			).rejects.toThrow( 'Failed to fetch assistant' );
		} );
	} );
} );
