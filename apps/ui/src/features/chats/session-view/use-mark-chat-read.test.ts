import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMarkChatRead } from './use-mark-chat-read';
import type { AiSessionSummary } from '@/data/core';

const mutate = vi.hoisted( () => vi.fn() );

vi.mock( '@/data/queries/use-sessions', () => ( {
	useUpdateSessionMetadata: () => ( { mutate } ),
} ) );

const summary = ( unread: boolean ) => ( { id: 'chat-1', unread } ) as AiSessionSummary;
const markedRead = { sessionId: 'chat-1', patch: { unread: false } };

describe( 'useMarkChatRead', () => {
	beforeEach( () => {
		mutate.mockClear();
		vi.spyOn( document, 'hasFocus' ).mockReturnValue( true );
	} );

	it( 'clears an opened chat but keeps it unread when marked by hand', () => {
		const { rerender } = renderHook(
			( props: { summary?: AiSessionSummary } ) =>
				useMarkChatRead( 'chat-1', props.summary, false ),
			{ initialProps: {} }
		);
		rerender( { summary: summary( true ) } );
		expect( mutate ).toHaveBeenCalledWith( markedRead );

		mutate.mockClear();
		rerender( { summary: summary( false ) } );
		rerender( { summary: summary( true ) } );
		expect( mutate ).not.toHaveBeenCalled();

		window.dispatchEvent( new Event( 'focus' ) );
		expect( mutate ).toHaveBeenCalledWith( markedRead );
	} );

	it( 'clears the unread flag a turn ending in view brings', () => {
		const { rerender } = renderHook(
			( props: { unread: boolean; active: boolean } ) =>
				useMarkChatRead( 'chat-1', summary( props.unread ), props.active ),
			{ initialProps: { unread: false, active: true } }
		);
		rerender( { unread: false, active: false } );
		rerender( { unread: true, active: false } );

		expect( mutate ).toHaveBeenCalledWith( markedRead );
	} );
} );
