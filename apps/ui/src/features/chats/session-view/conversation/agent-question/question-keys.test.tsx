import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Conversation } from '@/features/chats/session-view/conversation';
import { renderWithProviders } from '@/test/render';
import type { LoadedAiSession, SessionEntry } from '@/data/core';

const question = 'Which layout?';

async function renderQuestion( pending: boolean ) {
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
	renderWithProviders(
		<>
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
		</>
	);
	await screen.findByRole( 'group', { name: question } );
	return { onAnswerQuestion, onChooseFreeForm };
}

describe( 'Agent question keys', () => {
	it( 'answers with the option lettered like the key pressed inside the question', async () => {
		const { onAnswerQuestion, onChooseFreeForm } = await renderQuestion( true );
		const group = screen.getByRole( 'group', { name: question } );

		fireEvent.keyDown( document.body, { key: 'b' } );
		fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Composer' } ), { key: 'a' } );
		expect( onAnswerQuestion ).not.toHaveBeenCalled();

		fireEvent.keyDown( group, { key: 'b' } );
		expect( onAnswerQuestion ).toHaveBeenCalledWith( question, 'List' );

		fireEvent.keyDown( screen.getByRole( 'radio', { name: 'Grid' } ), { key: 'C' } );
		expect( onChooseFreeForm ).toHaveBeenCalledWith( question );
	} );

	it( 'moves between options with the arrow keys without answering', async () => {
		const { onAnswerQuestion } = await renderQuestion( true );
		const grid = screen.getByRole( 'radio', { name: 'Grid' } );
		grid.focus();

		fireEvent.keyDown( grid, { key: 'ArrowDown' } );
		expect( screen.getByRole( 'radio', { name: 'List' } ) ).toHaveFocus();
		fireEvent.keyDown( document.activeElement!, { key: 'ArrowUp' } );
		fireEvent.keyDown( document.activeElement!, { key: 'ArrowUp' } );
		expect( screen.getByRole( 'radio', { name: 'Something else' } ) ).toHaveFocus();
		expect( onAnswerQuestion ).not.toHaveBeenCalled();
	} );

	it( 'leaves the keys alone once the question is no longer waiting', async () => {
		const { onAnswerQuestion } = await renderQuestion( false );
		fireEvent.keyDown( screen.getByRole( 'group', { name: question } ), { key: 'a' } );
		expect( onAnswerQuestion ).not.toHaveBeenCalled();
	} );
} );
