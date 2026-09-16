import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { describe, expect, it, vi } from 'vitest';
import { Conversation } from '.';
import type { LoadedAiSession, SessionEntry } from '@/data/core';

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( {
		capabilities: { readLocalMedia: false },
		copyText: vi.fn().mockResolvedValue( undefined ),
	} ),
} ) );

function assistantReply( text: string ): SessionEntry {
	return {
		type: 'message',
		message: { role: 'assistant', content: [ { type: 'text', text } ] },
	} as unknown as SessionEntry;
}

function renderConversation( { isRunning = false }: { isRunning?: boolean } = {} ) {
	const data = {
		summary: { id: 'session-1' },
		entries: [ assistantReply( 'First reply' ), assistantReply( 'Second reply' ) ],
	} as unknown as LoadedAiSession;

	return render(
		<QueryClientProvider client={ new QueryClient() }>
			<Tooltip.Provider delay={ 0 }>
				<Conversation
					data={ data }
					isRunning={ isRunning }
					startedAt={ null }
					pendingQuestions={ new Set() }
					pendingAnswers={ {} }
					freeFormQuestion={ null }
					onAnswerQuestion={ vi.fn() }
					onChooseFreeForm={ vi.fn() }
				/>
			</Tooltip.Provider>
		</QueryClientProvider>
	);
}

function openTurnTexts( container: HTMLElement ) {
	return Array.from( container.querySelectorAll( '[data-actions-open="true"]' ) ).map(
		( turn ) => turn.textContent
	);
}

describe( 'Conversation message actions', () => {
	it( 'opens the actions on the newest reply without any interaction', () => {
		const { container } = renderConversation();

		expect( openTurnTexts( container ) ).toEqual( [ 'Second reply' ] );
	} );

	it( 'holds the actions back while the turn is still running', () => {
		const { container } = renderConversation( { isRunning: true } );

		expect( openTurnTexts( container ) ).toEqual( [] );
	} );

	it( 'opens an older reply when clicked and closes it when clicked again', () => {
		const { container } = renderConversation();

		fireEvent.click( screen.getByText( 'First reply' ) );
		expect( openTurnTexts( container ) ).toEqual( [ 'First reply', 'Second reply' ] );

		fireEvent.click( screen.getByText( 'First reply' ) );
		expect( openTurnTexts( container ) ).toEqual( [ 'Second reply' ] );
	} );

	it( 'ignores a click that ends a text selection', () => {
		const { container } = renderConversation();
		vi.spyOn( window, 'getSelection' ).mockReturnValue( {
			isCollapsed: false,
			toString: () => 'First',
		} as unknown as Selection );

		fireEvent.click( screen.getByText( 'First reply' ) );

		expect( openTurnTexts( container ) ).toEqual( [ 'Second reply' ] );
		vi.restoreAllMocks();
	} );
} );
