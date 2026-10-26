import { STOPPED_WITHOUT_ANSWER } from '@studio/common/ai/tools';
import { act, fireEvent, screen } from '@testing-library/react';
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
	const entry = agentQuestionEntry( question, options ) as SessionEntry & { data: object };
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

		it( 'folds answered questions into editable summaries before showing the next', async () => {
			vi.useFakeTimers();
			const onAnswerQuestion = vi.fn();
			renderInteractiveConversation(
				loadedSession( [
					agentQuestionEntry(
						'Install Jetpack?',
						[
							{ label: 'Yes', description: 'Install Jetpack recommended tools.' },
							{ label: 'No', description: 'Skip Jetpack setup.' },
						],
						'q1'
					),
					agentQuestionEntry( 'Activate dark mode?', [ 'Yes', 'No' ], 'q2' ),
					agentQuestionEntry( 'Pick a layout?', [ 'Grid', 'List' ], 'q3' ),
				] ),
				[ 'Install Jetpack?', 'Activate dark mode?', 'Pick a layout?' ],
				onAnswerQuestion
			);

			expect( screen.getByText( 'Asking question 1 of 3' ) ).toBeInTheDocument();
			expect( screen.getByText( 'Install Jetpack recommended tools.' ) ).toBeInTheDocument();
			expect( screen.queryByText( 'Activate dark mode?' ) ).not.toBeInTheDocument();

			fireEvent.click( screen.getByRole( 'radio', { name: 'Yes' } ) );

			expect( onAnswerQuestion ).toHaveBeenCalledWith( 'Install Jetpack?', 'Yes' );
			expect( screen.getByRole( 'radio', { name: 'Yes' } ) ).toBeChecked();
			expect( screen.queryByText( 'Activate dark mode?' ) ).not.toBeInTheDocument();

			await advance( 700 );
			await advance( 20 );

			const summary = screen.getByRole( 'button', {
				name: 'Edit question 1 of 3: Install Jetpack?. Selected answer: Yes',
			} );
			expect( summary ).not.toHaveTextContent( 'Install Jetpack recommended tools.' );
			expect( screen.queryByText( 'Skip Jetpack setup.' ) ).not.toBeInTheDocument();
			expect( screen.getByText( 'Asking question 2 of 3' ) ).toBeInTheDocument();
			expect( screen.getByRole( 'group', { name: 'Activate dark mode?' } ) ).toHaveFocus();

			fireEvent.click( summary );

			expect( screen.getByText( 'Asking question 1 of 3' ) ).toBeInTheDocument();
			expect( screen.getByRole( 'radio', { name: 'Yes' } ) ).toBeChecked();
			expect( screen.queryByText( 'Activate dark mode?' ) ).not.toBeInTheDocument();

			fireEvent.click( screen.getByRole( 'radio', { name: 'No' } ) );
			expect( onAnswerQuestion ).toHaveBeenCalledWith( 'Install Jetpack?', 'No' );

			await advance( 700 );

			expect(
				screen.getByRole( 'button', {
					name: 'Edit question 1 of 3: Install Jetpack?. Selected answer: No',
				} )
			).toBeInTheDocument();
			expect( screen.getByText( 'Asking question 2 of 3' ) ).toBeInTheDocument();
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
			{ reducedMotion: false, wait: 700, behavior: 'smooth' },
			{ reducedMotion: true, wait: 0, behavior: 'auto' },
		] )(
			'scrolls the next batched question into view (reduced motion: $reducedMotion)',
			async ( { reducedMotion, wait, behavior } ) => {
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
				if ( ! reducedMotion ) {
					expect( screen.queryByText( 'Asking question 2 of 2' ) ).not.toBeInTheDocument();
				}
				await advance( wait );
				await advance( 20 );

				expect( screen.getByText( 'Asking question 2 of 2' ) ).toBeInTheDocument();
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
		fireEvent.click( screen.getByRole( 'button', { name: 'Submit choices' } ) );
		expect( onAnswerQuestion ).toHaveBeenCalledWith( 'Which finish?', 'White, Speckle' );
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

		it( 'offers the free-form option the AskUserQuestion tool promises the model', () => {
			const onChooseFreeForm = vi.fn();
			renderConversation(
				loadedSession( [ agentQuestionEntry( question, [ 'Yes', 'No' ], 'q1' ) ] ),
				{ pendingQuestions: new Set( [ question ] ), onChooseFreeForm }
			);

			const choice = screen.getByRole( 'radio', { name: 'Something else' } );
			expect( choice ).not.toBeChecked();
			fireEvent.click( choice );
			expect( onChooseFreeForm ).toHaveBeenCalledWith( question );
		} );

		it( 'marks the free-form option as armed once chosen', () => {
			renderConversation(
				loadedSession( [ agentQuestionEntry( question, [ 'Yes', 'No' ], 'q1' ) ] ),
				{ pendingQuestions: new Set( [ question ] ), freeFormQuestion: question }
			);

			expect( screen.getByRole( 'radio', { name: 'Something else' } ) ).toBeChecked();
		} );

		it( 'hides the free-form option once the batch is no longer interactive', () => {
			renderConversation(
				loadedSession( [ agentQuestionEntry( question, [ 'Yes', 'No' ], 'q1' ) ] )
			);

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
		} );

		it( 'does not pass off the stop marker as something the user wrote', () => {
			renderConversation(
				loadedSession( [
					agentQuestionEntry( 'Favorite color?', [ 'Blue', 'Green' ], 'q1' ),
					askUserAnswerEntry( 'a1', STOPPED_WITHOUT_ANSWER ),
				] )
			);

			expect( screen.queryByText( STOPPED_WITHOUT_ANSWER ) ).not.toBeInTheDocument();
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
