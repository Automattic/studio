import { renderHook, act } from '@testing-library/react';
import { ReactNode } from 'react';
import { ChatInputProvider, useChatInputContext } from '../use-chat-input';

const wrapper = ( { children }: { children: ReactNode } ) => (
	<ChatInputProvider>{ children }</ChatInputProvider>
);

describe( 'useChatInput hook', () => {
	it( 'should provide default values', () => {
		const { result } = renderHook( () => useChatInputContext(), { wrapper } );

		expect( result.current.getChatInput( 'site-1' ) ).toBe( '' );
	} );

	it( 'should save and retrieve chat input', () => {
		const { result } = renderHook( () => useChatInputContext(), { wrapper } );

		act( () => {
			result.current.saveChatInput( 'Hello, world!', 'site-1' );
		} );

		expect( result.current.getChatInput( 'site-1' ) ).toBe( 'Hello, world!' );
	} );

	it( 'should update chat input for different sites', () => {
		const { result } = renderHook( () => useChatInputContext(), { wrapper } );

		act( () => {
			result.current.saveChatInput( 'Hello, site-1!', 'site-1' );
			result.current.saveChatInput( 'Hello, site-2!', 'site-2' );
		} );

		expect( result.current.getChatInput( 'site-1' ) ).toBe( 'Hello, site-1!' );
		expect( result.current.getChatInput( 'site-2' ) ).toBe( 'Hello, site-2!' );
	} );
} );
