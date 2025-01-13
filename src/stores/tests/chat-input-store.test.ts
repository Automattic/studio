import { act, renderHook } from '@testing-library/react';
import { useChatInputStore } from '../chat-input-store';

describe( 'useChatInputStore', () => {
	beforeEach( () => {
		act( () => {
			useChatInputStore.setState( { inputBySite: {} } );
		} );
	} );

	it( 'saves and retrieves chat input by site', () => {
		const { result } = renderHook( () => useChatInputStore() );

		act( () => {
			result.current.saveChatInput( 'test input 1', 'site-1' );
			result.current.saveChatInput( 'test input 2', 'site-2' );
		} );

		expect( result.current.getChatInput( 'site-1' ) ).toBe( 'test input 1' );
		expect( result.current.getChatInput( 'site-2' ) ).toBe( 'test input 2' );
	} );

	it( 'returns empty string for non-existent site input', () => {
		const { result } = renderHook( () => useChatInputStore() );
		expect( result.current.getChatInput( 'non-existent-site' ) ).toBe( '' );
	} );
} );
