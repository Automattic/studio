import { SKIPPED_QUESTION, STOPPED_WITHOUT_ANSWER } from '@studio/agent/protocol/tools';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
	agentQuestionEntry,
	askUserAnswerEntry,
} from '@/features/chats/session-view/conversation/test-entries';
import {
	loadedSession,
	renderConversation,
	renderInteractiveConversation,
} from '@/features/chats/session-view/conversation/test-render';
import type { SessionEntry } from '@/data/core';

function multiSelectEntry( question: string, options: string[] ) {
	const entry = agentQuestionEntry( question, options, 'q-multi' ) as SessionEntry & {
		data: object;
	};
	return { ...entry, data: { ...entry.data, multiSelect: true } } as SessionEntry;
}

describe( 'Conversation Ask User questions', () => {
	describe( 'live batches', () => {
		let scrollBy: MockInstance< typeof window.scrollBy >;

		beforeEach( () => {
			scrollBy = vi.spyOn( window, 'scrollBy' ).mockImplementation( () => {} );
			// Every question sits just below the fold, under the composer.
			vi.spyOn( HTMLElement.prototype, 'getBoundingClientRect' ).mockReturnValue( {
				top: window.innerHeight + 24,
				bottom: window.innerHeight + 124,
			} as DOMRect );
		} );

		afterEach( () => {
			vi.useRealTimers();
			vi.restoreAllMocks();
		} );

		const advance = ( ms: number ) => act( async () => vi.advanceTimersByTime( ms ) );

		it( 'advances on selection and preserves answers when navigating back', async () => {
			vi.useFakeTimers();
			const onAnswerQuestion = vi.fn();
			renderInteractiveConversation(
				loadedSession( [
					agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
					agentQuestionEntry( 'Activate dark mode?', [ 'Yes', 'No' ], 'q2' ),
					agentQuestionEntry( 'Pick a layout?', [ 'Grid', 'List' ], 'q3' ),
				] ),
				[ 'Install Jetpack?', 'Activate dark mode?', 'Pick a layout?' ],
				onAnswerQuestion
			);
			expect( screen.getByRole( 'button', { name: 'Next' } ) ).toBeEnabled();
			expect( screen.queryByRole( 'button', { name: 'Back' } ) ).not.toBeInTheDocument();
			const pager = screen.getByRole( 'img', { name: 'Question 1 of 3' } );
			expect( within( pager ).queryByRole( 'button' ) ).not.toBeInTheDocument();
			fireEvent.click( pager );
			expect( screen.getByRole( 'group', { name: 'Install Jetpack?' } ) ).toBeVisible();
			fireEvent.click( screen.getByRole( 'radio', { name: 'Yes' } ) );
			expect( onAnswerQuestion ).toHaveBeenCalledWith( 'Install Jetpack?', 'Yes' );
			await advance( 20 );
			expect( screen.getByRole( 'group', { name: 'Activate dark mode?' } ) ).toHaveFocus();
			fireEvent.click( screen.getByRole( 'button', { name: 'Skip' } ) );
			expect( screen.getByRole( 'img', { name: 'Question 3 of 3' } ) ).toBeVisible();
			expect( screen.getByRole( 'button', { name: 'Done' } ) ).toBeEnabled();
			fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
			expect( screen.getByRole( 'img', { name: 'Question 2 of 3' } ) ).toBeVisible();
			fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
			expect( screen.getByRole( 'radio', { name: 'Yes' } ) ).toBeChecked();
			expect( screen.queryByRole( 'button', { name: 'Back' } ) ).not.toBeInTheDocument();
			fireEvent.click( screen.getByRole( 'radio', { name: 'No' } ) );
			expect( screen.getByRole( 'img', { name: 'Question 2 of 3' } ) ).toBeVisible();
			fireEvent.click( screen.getByRole( 'button', { name: 'Next' } ) );
			fireEvent.click( screen.getByRole( 'radio', { name: 'Grid' } ) );
			expect(
				within( screen.getByRole( 'group', { name: 'Install Jetpack?' } ) ).getByText( 'No' )
			).toBeVisible();
			expect( screen.getByText( 'Grid' ) ).toBeVisible();
			expect( screen.queryByText( 'List' ) ).not.toBeInTheDocument();
			expect( screen.getByRole( 'group', { name: 'Activate dark mode?' } ) ).toBeDisabled();
			expect( screen.queryByRole( 'button', { name: 'Skip' } ) ).not.toBeInTheDocument();
		} );

		it( 'allows Next without a selection and preserves a draft when going Back', () => {
			const onAnswerQuestion = vi.fn();
			renderInteractiveConversation(
				loadedSession( [
					agentQuestionEntry( 'Page?', [ 'Gallery', 'Contact' ], 'q1' ),
					multiSelectEntry( 'Layout?', [ 'Grid', 'List' ] ),
				] ),
				[ 'Page?', 'Layout?' ],
				onAnswerQuestion
			);
			fireEvent.click( screen.getByRole( 'button', { name: 'Next' } ) );
			expect( onAnswerQuestion ).toHaveBeenCalledWith( 'Page?', SKIPPED_QUESTION );
			fireEvent.click( screen.getByRole( 'checkbox', { name: 'Grid' } ) );
			fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
			expect( onAnswerQuestion ).toHaveBeenCalledTimes( 1 );
			fireEvent.click( screen.getByRole( 'radio', { name: 'Contact' } ) );
			expect( screen.getByRole( 'checkbox', { name: 'Grid' } ) ).toBeChecked();
			fireEvent.click( screen.getByRole( 'button', { name: 'Done' } ) );
			expect( onAnswerQuestion.mock.calls ).toEqual( [
				[ 'Page?', SKIPPED_QUESTION ],
				[ 'Page?', 'Contact' ],
				[ 'Layout?', 'Grid' ],
			] );
		} );

		it( 'submits a lone question immediately when an option is selected', () => {
			const onAnswerQuestion = vi.fn();
			renderInteractiveConversation(
				loadedSession( [ agentQuestionEntry( 'Page?', [ 'Gallery', 'Contact' ], 'q1' ) ] ),
				[ 'Page?' ],
				onAnswerQuestion
			);
			fireEvent.click( screen.getByRole( 'radio', { name: 'Gallery' } ) );
			expect( onAnswerQuestion ).toHaveBeenCalledWith( 'Page?', 'Gallery' );
			expect( screen.queryByRole( 'button', { name: 'Done' } ) ).not.toBeInTheDocument();
			expect( screen.queryByText( 'Contact' ) ).not.toBeInTheDocument();
		} );

		it( 'submits unanswered questions as skipped rather than empty answers', () => {
			const onAnswerQuestion = vi.fn();
			renderInteractiveConversation(
				loadedSession( [ agentQuestionEntry( 'Page?', [ 'Gallery', 'Contact' ], 'q1' ) ] ),
				[ 'Page?' ],
				onAnswerQuestion
			);
			fireEvent.click( screen.getByRole( 'button', { name: 'Done' } ) );
			expect( onAnswerQuestion ).toHaveBeenCalledWith( 'Page?', SKIPPED_QUESTION );
			expect( screen.getByRole( 'group', { name: 'Page?' } ) ).toBeDisabled();
		} );

		it( 'allows every question to be skipped without selecting an answer', () => {
			const onAnswerQuestion = vi.fn();
			renderInteractiveConversation(
				loadedSession( [ agentQuestionEntry( 'Pick a layout?', [ 'Grid', 'List' ], 'q1' ) ] ),
				[ 'Pick a layout?' ],
				onAnswerQuestion
			);
			fireEvent.click( screen.getByRole( 'button', { name: 'Skip' } ) );
			expect( onAnswerQuestion ).toHaveBeenCalledWith( 'Pick a layout?', SKIPPED_QUESTION );
			expect( screen.getByRole( 'radio', { name: 'Grid' } ) ).not.toBeChecked();
			expect( screen.getByRole( 'group', { name: 'Pick a layout?' } ) ).toBeDisabled();
			expect( screen.queryByText( SKIPPED_QUESTION ) ).not.toBeInTheDocument();
		} );

		it( 'scrolls a lone question into view when it is asked', async () => {
			vi.useFakeTimers();
			renderInteractiveConversation(
				loadedSession( [ agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ) ] ),
				[ 'Install Jetpack?' ],
				vi.fn()
			);

			await advance( 20 );

			expect( scrollBy ).toHaveBeenCalledWith( { top: 220, behavior: 'smooth' } );
		} );

		it.each( [
			{ reducedMotion: false, behavior: 'smooth' },
			{ reducedMotion: true, behavior: 'auto' },
		] )(
			'scrolls the next batched question into view (reduced motion: $reducedMotion)',
			async ( { reducedMotion, behavior } ) => {
				const matchMedia = window.matchMedia;
				vi.spyOn( window, 'matchMedia' ).mockImplementation( ( query ) => ( {
					...matchMedia( query ),
					matches: reducedMotion && query === '(prefers-reduced-motion: reduce)',
				} ) );
				vi.useFakeTimers();
				renderInteractiveConversation(
					loadedSession( [
						agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
						agentQuestionEntry( 'Activate dark mode?', [ 'Yes', 'No' ], 'q2' ),
					] ),
					[ 'Install Jetpack?', 'Activate dark mode?' ],
					vi.fn()
				);
				await advance( 20 );
				scrollBy.mockClear();
				fireEvent.click( screen.getByRole( 'radio', { name: 'Yes' } ) );
				await advance( 20 );
				expect( screen.getByRole( 'img', { name: 'Question 2 of 2' } ) ).toBeVisible();
				expect( scrollBy ).toHaveBeenCalledWith( { top: 220, behavior } );
			}
		);
	} );

	it( 'renders submitted batch summaries without reopening their answers', () => {
		renderConversation(
			loadedSession( [
				agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
				agentQuestionEntry( 'Activate dark mode?', [ 'Yes', 'No' ], 'q2' ),
				askUserAnswerEntry( 'a1', 'No' ),
				askUserAnswerEntry( 'a2', 'Yes' ),
			] )
		);

		expect( screen.getByText( 'Install Jetpack?' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Activate dark mode?' ) ).toBeInTheDocument();
		expect( screen.getByText( 'No' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Yes' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: /^Edit question/ } ) ).not.toBeInTheDocument();
		expect( screen.queryByText( /^Asking question/ ) ).not.toBeInTheDocument();
	} );

	it.each( [ false, true ] )(
		'shows only selected labels in answered cards (multiple: %s)',
		( multiSelect ) => {
			const entry = agentQuestionEntry( 'Which pages?', [
				{ label: 'Gallery', description: 'Photos of the dining room.' },
				{ label: 'Menu', description: 'Seasonal dishes and prices.' },
				{ label: 'Contact', description: 'Opening hours and directions.' },
			] ) as SessionEntry & { data: object };
			renderConversation(
				loadedSession( [
					{ ...entry, data: { ...entry.data, multiSelect } } as SessionEntry,
					askUserAnswerEntry( 'answer', multiSelect ? 'Gallery, Menu' : 'Gallery' ),
				] )
			);
			expect( screen.getByText( 'Gallery' ) ).toBeVisible();
			expect( screen.queryByText( 'Photos of the dining room.' ) ).not.toBeInTheDocument();
			if ( multiSelect ) {
				expect( screen.getByText( 'Menu' ) ).toBeVisible();
			} else {
				expect( screen.queryByText( 'Seasonal dishes and prices.' ) ).not.toBeInTheDocument();
			}
			expect( screen.queryByText( 'Opening hours and directions.' ) ).not.toBeInTheDocument();
			expect( screen.queryByRole( 'radio' ) ).not.toBeInTheDocument();
			expect( screen.queryByRole( 'checkbox' ) ).not.toBeInTheDocument();
		}
	);

	it( 'waits for confirmation before submitting multiple choices', () => {
		const onAnswerQuestion = vi.fn();
		renderConversation(
			loadedSession( [ multiSelectEntry( 'Which finish?', [ 'White', 'Speckle' ] ) ] ),
			{
				pendingQuestions: new Set( [ 'Which finish?' ] ),
				onAnswerQuestion,
			}
		);

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'White' } ) );
		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Speckle' } ) );
		expect( onAnswerQuestion ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Done' } ) );
		expect( onAnswerQuestion ).toHaveBeenCalledWith( 'Which finish?', 'White, Speckle' );
	} );

	it( 'allows a reopened batch to retry a cached selection after submission fails', () => {
		const onAnswerQuestion = vi.fn();
		renderConversation(
			loadedSession( [ agentQuestionEntry( 'Page?', [ 'Gallery', 'Contact' ], 'q1', 'Gallery' ) ] ),
			{ pendingQuestions: new Set( [ 'Page?' ] ), onAnswerQuestion }
		);
		expect( screen.getByRole( 'radio', { name: 'Gallery' } ) ).toBeChecked();
		fireEvent.click( screen.getByRole( 'button', { name: 'Done' } ) );
		expect( onAnswerQuestion ).toHaveBeenCalledWith( 'Page?', 'Gallery' );
	} );

	it( 'keeps only the saved decision visible when reopening history', () => {
		renderConversation(
			loadedSession( [
				agentQuestionEntry( 'Which finish?', [ 'White', 'Speckle' ], 'q1', 'Speckle' ),
			] )
		);

		expect( screen.getByText( 'Which finish?' ) ).toBeVisible();
		expect( screen.getByText( 'Speckle' ) ).toBeVisible();
		expect( screen.queryByText( 'White' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'textbox' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'radio' ) ).not.toBeInTheDocument();
	} );

	describe( 'free-form answers', () => {
		const question = 'Install Jetpack?';

		it( 'does not append a generic free-form option', () => {
			renderConversation(
				loadedSession( [ agentQuestionEntry( question, [ 'Yes', 'No' ], 'q1' ) ] ),
				{ pendingQuestions: new Set( [ question ] ) }
			);
			expect( screen.getAllByRole( 'radio' ) ).toHaveLength( 2 );
			expect( screen.queryByRole( 'radio', { name: 'Something else' } ) ).not.toBeInTheDocument();
		} );

		it( 'arms the composer from an escape hatch the model wrote itself, without duplicating it', () => {
			const onChooseFreeForm = vi.fn();
			const onAnswerQuestion = vi.fn();
			renderConversation(
				loadedSession( [ agentQuestionEntry( question, [ 'Yes', 'Something else' ], 'q1' ) ] ),
				{ pendingQuestions: new Set( [ question ] ), onChooseFreeForm, onAnswerQuestion }
			);

			const choices = screen.getAllByRole( 'radio', { name: 'Something else' } );
			expect( choices ).toHaveLength( 1 );
			fireEvent.click( choices[ 0 ] );

			expect( onChooseFreeForm ).toHaveBeenCalledWith( question );
			expect( onAnswerQuestion ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'typed answers', () => {
		it( 'pairs each typed answer with its own question without repeating picked options', () => {
			renderConversation(
				loadedSession( [
					agentQuestionEntry( 'Favorite color?', [ 'Blue', 'Green' ], 'q1' ),
					agentQuestionEntry( 'Favorite season?', [ 'Spring', 'Autumn' ], 'q2' ),
					askUserAnswerEntry( 'a1', 'Blue' ),
					askUserAnswerEntry( 'a2', 'monsoon' ),
				] )
			);

			expect( screen.getByText( 'monsoon' ) ).toBeInTheDocument();
			expect( screen.getAllByText( 'Blue' ) ).toHaveLength( 1 );
			expect( screen.queryByText( 'Green' ) ).not.toBeInTheDocument();
			expect( screen.queryByRole( 'radio' ) ).not.toBeInTheDocument();
		} );

		it( 'does not pass off the stop marker as something the user wrote', () => {
			renderConversation(
				loadedSession( [
					agentQuestionEntry( 'Favorite color?', [ 'Blue', 'Green' ], 'q1' ),
					askUserAnswerEntry( 'a1', STOPPED_WITHOUT_ANSWER ),
				] )
			);

			expect( screen.queryByText( STOPPED_WITHOUT_ANSWER ) ).not.toBeInTheDocument();
			expect( screen.getByRole( 'group', { name: 'Favorite color?' } ) ).toBeDisabled();
			expect( screen.getByRole( 'radio', { name: 'Blue' } ) ).toBeDisabled();
			expect( screen.getByRole( 'radio', { name: 'Green' } ) ).toBeDisabled();
			expect( screen.getByText( 'A' ) ).toBeVisible();
			expect( screen.getByText( 'B' ) ).toBeVisible();
		} );

		it( 'keeps skipped questions in a batch disabled instead of summarizing them as answers', () => {
			renderConversation(
				loadedSession( [
					agentQuestionEntry( 'Favorite color?', [ 'Blue', 'Green' ], 'q1' ),
					agentQuestionEntry( 'Favorite season?', [ 'Spring', 'Autumn' ], 'q2' ),
					askUserAnswerEntry( 'a1', 'Blue' ),
					askUserAnswerEntry( 'a2', STOPPED_WITHOUT_ANSWER ),
				] )
			);

			expect( screen.queryByText( STOPPED_WITHOUT_ANSWER ) ).not.toBeInTheDocument();
			expect( screen.getByRole( 'group', { name: 'Favorite season?' } ) ).toBeDisabled();
			expect( screen.getByRole( 'radio', { name: 'Spring' } ) ).toBeDisabled();
			expect( screen.queryByText( 'Green' ) ).not.toBeInTheDocument();
		} );

		it( 'shows an answer typed into the composer for a multiple-choice question as given', () => {
			renderConversation(
				loadedSession( [
					multiSelectEntry( 'Which pages?', [ 'Blog', 'Contact', 'Shop' ] ),
					askUserAnswerEntry( 'a1', 'Contact, Shop, A landing page' ),
				] )
			);

			expect( screen.getByText( 'Contact, Shop, A landing page' ) ).toBeInTheDocument();
		} );
	} );
} );
