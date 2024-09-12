import { renderHook, act } from '@testing-library/react';
import { useAssistant } from '../use-assistant';

interface Message {
	content: string;
	role: 'user' | 'assistant';
	id?: number;
}

describe( 'useAssistant', () => {
	const selectedSiteId = 'test-site';
	const MOCKED_TIME = 1718882159928;

	beforeEach( () => {
		localStorage.clear();
		jest.useFakeTimers();
		jest.setSystemTime( MOCKED_TIME );
	} );

	afterEach( () => {
		jest.useRealTimers();
	} );

	it( 'should initialize with messages from localStorage', () => {
		const initialMessages: Message[] = [
			{ content: 'Hello', role: 'user' },
			{ content: 'Hi there', role: 'assistant' },
		];
		localStorage.setItem(
			`ai_chat_messages`,
			JSON.stringify( { [ selectedSiteId ]: initialMessages } )
		);

		const { result } = renderHook( () => useAssistant( selectedSiteId ) );

		expect( result.current.messages ).toEqual( initialMessages );
	} );

	it( 'should add a message correctly', () => {
		const { result } = renderHook( () => useAssistant( selectedSiteId ) );

		act( () => {
			result.current.addMessage( 'Hello', 'user' );
		} );

		expect( result.current.messages ).toEqual( [
			{
				chatId: undefined,
				content: 'Hello',
				role: 'user',
				id: 0,
				createdAt: MOCKED_TIME,
				feedbackReceived: false,
				messageApiId: undefined,
			},
		] );
		expect( localStorage.getItem( `ai_chat_messages` ) ).toEqual(
			JSON.stringify( {
				[ selectedSiteId ]: [
					{
						chatId: undefined,
						content: 'Hello',
						role: 'user',
						id: 0,
						createdAt: MOCKED_TIME,
						feedbackReceived: false,
						messageApiId: undefined,
					},
				],
			} )
		);
	} );

	it( 'should clear messages correctly', () => {
		const { result } = renderHook( () => useAssistant( selectedSiteId ) );

		act( () => {
			result.current.addMessage( 'Hello', 'user' );
		} );
		act( () => {
			result.current.clearMessages();
		} );

		expect( result.current.messages ).toEqual( [] );
		expect( localStorage.getItem( 'ai_chat_messages' ) ).toEqual( JSON.stringify( {} ) );
	} );
} );
