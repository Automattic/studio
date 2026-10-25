import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Conversation } from '@/features/chats/session-view/conversation';
import { TooltipProvider } from '@/lib/ui';
import type { LoadedAiSession, SessionEntry } from '@/data/core';

vi.mock( '@/data/core', () => ( { useConnector: () => ( {} ) } ) );

const question = 'Which layout?';

function renderQuestion( pending: boolean ) {
	const data = {
		summary: { id: 'session-1' },
		entries: [
			{
				type: 'custom',
				id: 'q1',
				parentId: null,
				timestamp: '2026-10-22T12:00:00.000Z',
				customType: 'studio.agent_question',
				data: {
					question,
					options: [
						{ label: 'Grid', description: '' },
						{ label: 'List', description: '' },
					],
				},
			} as SessionEntry,
		],
	} as unknown as LoadedAiSession;
	const onAnswerQuestion = vi.fn();
	const onChooseFreeForm = vi.fn();
	render(
		<QueryClientProvider client={ new QueryClient() }>
			<TooltipProvider delay={ 0 }>
				<Conversation
					data={ data }
					isRunning={ pending }
					startedAt={ null }
					pendingQuestions={ new Set( pending ? [ question ] : [] ) }
					pendingAnswers={ {} }
					freeFormQuestion={ null }
					onAnswerQuestion={ onAnswerQuestion }
					onChooseFreeForm={ onChooseFreeForm }
				/>
				<textarea aria-label="Composer" />
			</TooltipProvider>
		</QueryClientProvider>
	);
	return { onAnswerQuestion, onChooseFreeForm };
}

describe( 'Agent question keys', () => {
	it( 'answers with the option lettered like the key pressed, outside text fields', () => {
		const { onAnswerQuestion, onChooseFreeForm } = renderQuestion( true );

		fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Composer' } ), { key: 'a' } );
		expect( onAnswerQuestion ).not.toHaveBeenCalled();

		fireEvent.keyDown( document.body, { key: 'b' } );
		expect( onAnswerQuestion ).toHaveBeenCalledWith( question, 'List' );

		fireEvent.keyDown( document.body, { key: 'C' } );
		expect( onChooseFreeForm ).toHaveBeenCalledWith( question );
	} );

	it( 'leaves the keys alone once the question is no longer waiting', () => {
		const { onAnswerQuestion } = renderQuestion( false );
		fireEvent.keyDown( document.body, { key: 'a' } );
		expect( onAnswerQuestion ).not.toHaveBeenCalled();
	} );
} );
