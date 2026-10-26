import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentQuestionBatch } from '@/features/chats/session-view/conversation/agent-question';
import { renderWithProviders } from '@/test/render';

const item = {
	key: 'finish',
	question: 'Which finish?',
	options: [
		{ label: 'White', description: 'A long explanation' },
		{ label: 'Speckle', description: 'Another explanation' },
	],
};

async function renderQuestion( {
	pending = true,
	pendingAnswers = {},
	...overrides
}: {
	pending?: boolean;
	pendingAnswers?: Record< string, string >;
	pickedLabel?: string;
	multiSelect?: boolean;
} = {} ) {
	const onAnswer = vi.fn();
	renderWithProviders(
		<AgentQuestionBatch
			questions={ [ { ...item, ...overrides } ] }
			pendingQuestions={ new Set( pending ? [ item.question ] : [] ) }
			pendingAnswers={ pendingAnswers }
			freeFormQuestion={ null }
			onAnswer={ onAnswer }
			onChooseFreeForm={ vi.fn() }
		/>
	);
	await screen.findByText( item.question );
	return { onAnswer };
}

describe( 'Chat questions', () => {
	it( 'waits for confirmation before submitting multiple choices', async () => {
		const { onAnswer } = await renderQuestion( { multiSelect: true } );
		fireEvent.click( screen.getByRole( 'checkbox', { name: 'White' } ) );
		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Speckle' } ) );
		expect( onAnswer ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Submit choices' } ) );
		expect( onAnswer ).toHaveBeenCalledWith( item.question, 'White, Speckle' );
	} );

	it( 'keeps only the saved decision visible when reopening history', async () => {
		await renderQuestion( { pending: false, pickedLabel: 'Speckle' } );
		expect( screen.getByText( item.question ) ).toBeVisible();
		expect( screen.getByText( 'Speckle' ) ).toBeVisible();
		expect( screen.queryByText( 'White' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'textbox' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'radio' ) ).not.toBeInTheDocument();
	} );

	it( 'collapses a submitted answer while other questions are still pending', async () => {
		const next = {
			key: 'size',
			question: 'Which size?',
			options: [ { label: 'Large', description: '' } ],
		};
		renderWithProviders(
			<AgentQuestionBatch
				questions={ [ item, next ] }
				pendingQuestions={ new Set( [ item.question, next.question ] ) }
				pendingAnswers={ { [ item.question ]: 'White' } }
				freeFormQuestion={ null }
				onAnswer={ vi.fn() }
				onChooseFreeForm={ vi.fn() }
			/>
		);
		await screen.findByText( next.question );
		expect( screen.getByText( 'White' ) ).toBeVisible();
		expect( screen.queryByText( 'Speckle' ) ).not.toBeInTheDocument();
	} );

	it( 'leaves custom answers to the composer without an inline input', async () => {
		await renderQuestion();
		expect( screen.queryByRole( 'textbox' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Submit' } ) ).not.toBeInTheDocument();
	} );
} );
