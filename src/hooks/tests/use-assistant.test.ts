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
		localStorage.setItem( selectedSiteId, JSON.stringify( initialMessages ) );

		const { result } = renderHook( () => useAssistant( selectedSiteId ) );

		expect( result.current.messages ).toEqual( initialMessages );
	} );

	it( 'should add a message correctly', () => {
		const { result } = renderHook( () => useAssistant( selectedSiteId ) );

		act( () => {
			result.current.addMessage( 'Hello', 'user' );
		} );

		expect( result.current.messages ).toEqual( [
			{ content: 'Hello', role: 'user', id: 0, createdAt: MOCKED_TIME },
		] );
		expect( localStorage.getItem( selectedSiteId ) ).toEqual(
			JSON.stringify( [ { content: 'Hello', role: 'user', id: 0, createdAt: MOCKED_TIME } ] )
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
		expect( localStorage.getItem( selectedSiteId ) ).toEqual( JSON.stringify( [] ) );
	} );
} );
