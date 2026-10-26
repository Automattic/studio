import { STOPPED_WITHOUT_ANSWER } from '@studio/common/ai/tools';
import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const connectorMocks = vi.hoisted( () => ( {
	readLocalMediaFile: vi.fn(),
	copyText: vi.fn( () => Promise.resolve() ),
} ) );

const reducedMotion = vi.hoisted( () => ( { value: false } ) );

vi.mock( '@/lib/hooks', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@/lib/hooks') >() ),
	useReducedMotion: () => reducedMotion.value,
} ) );

vi.mock( '@/features/chats/markdown', () => ( {
	Markdown: ( { children }: { children: string } ) => children,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => connectorMocks,
} ) );

beforeEach( () => {
	connectorMocks.readLocalMediaFile.mockReset();
	connectorMocks.copyText.mockReset();
} );

describe( 'Conversation Ask User questions', () => {
	it( 'shows a historical answer as its lettered option', () => {
		const question = "What kind of vibe do you want for your blog's design?";
		const data = loadedSession( [
			agentQuestionEntry(
				question,
				[
					{
						label: 'Minimal & Clean',
						description: 'Quiet typography, generous spacing, and simple structure.',
					},
					{
						label: 'Bold & Editorial',
						description: 'Large headlines, sharp contrast, and magazine-style pacing.',
					},
				],
				'question',
				'Bold & Editorial'
			),
		] );

		renderConversation( data );

		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'B' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Bold & Editorial' ) ).toBeInTheDocument();
	} );

	it( 'submits multi-select picks together on confirm', () => {
		const onAnswerQuestion = vi.fn();
		const entry = agentQuestionEntry( 'Which pages?', [
			'Blog',
			'Contact',
			'Shop',
		] ) as SessionEntry & {
			data: object;
		};
		renderConversation(
			loadedSession( [ { ...entry, data: { ...entry.data, multiSelect: true } } as SessionEntry ] ),
			{ pendingQuestions: new Set( [ 'Which pages?' ] ), onAnswerQuestion }
		);

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Shop' } ) );
		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Blog' } ) );
		expect( onAnswerQuestion ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Submit choices' } ) );
		expect( onAnswerQuestion ).toHaveBeenCalledWith( 'Which pages?', 'Blog, Shop' );
	} );

	it( 'folds answered live questions into summaries before showing the next question', async () => {
		vi.useFakeTimers();
		const originalScrollBy = window.scrollBy;
		window.scrollBy = vi.fn() as unknown as typeof window.scrollBy;
		try {
			const onAnswerQuestion = vi.fn();
			const data = loadedSession( [
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
			] );

			renderInteractiveConversation(
				data,
				[ 'Install Jetpack?', 'Activate dark mode?', 'Pick a layout?' ],
				onAnswerQuestion
			);

			expect( screen.getByText( 'Asking question 1 of 3' ) ).toBeInTheDocument();
			expect( screen.getByText( 'Install Jetpack?' ) ).toBeInTheDocument();
			expect( screen.getByText( 'Install Jetpack recommended tools.' ) ).toBeInTheDocument();
			expect( screen.queryByText( 'Activate dark mode?' ) ).not.toBeInTheDocument();

			fireEvent.click( screen.getByRole( 'radio', { name: 'Yes' } ) );

			expect( onAnswerQuestion ).toHaveBeenCalledWith( 'Install Jetpack?', 'Yes' );
			expect( screen.getByRole( 'radio', { name: 'Yes' } ) ).toBeChecked();
			expect( screen.queryByText( 'Activate dark mode?' ) ).not.toBeInTheDocument();

			await act( async () => vi.advanceTimersByTime( 700 ) );
			await act( async () => vi.advanceTimersByTime( 20 ) );

			const answeredSummary = screen.getByRole( 'button', {
				name: 'Edit question 1 of 3: Install Jetpack?. Selected answer: Yes',
			} );
			const activeQuestion = screen.getByRole( 'group', { name: 'Activate dark mode?' } );
			expect( answeredSummary ).toBeInTheDocument();
			expect( answeredSummary ).toHaveTextContent( 'Install Jetpack?' );
			expect( answeredSummary ).toHaveTextContent( 'Yes' );
			expect( answeredSummary ).not.toHaveTextContent( 'Install Jetpack recommended tools.' );
			expect( screen.queryByText( 'Skip Jetpack setup.' ) ).not.toBeInTheDocument();
			expect( screen.getByText( 'Asking question 2 of 3' ) ).toBeInTheDocument();
			expect( screen.getByText( 'Activate dark mode?' ) ).toBeInTheDocument();
			expect( activeQuestion ).toHaveFocus();

			fireEvent.click(
				screen.getByRole( 'button', {
					name: 'Edit question 1 of 3: Install Jetpack?. Selected answer: Yes',
				} )
			);

			expect( screen.getByText( 'Asking question 1 of 3' ) ).toBeInTheDocument();
			expect( screen.getByRole( 'radio', { name: 'Yes' } ) ).toBeChecked();
			expect( screen.queryByText( 'Activate dark mode?' ) ).not.toBeInTheDocument();

			fireEvent.click( screen.getByRole( 'radio', { name: 'No' } ) );
			expect( onAnswerQuestion ).toHaveBeenCalledWith( 'Install Jetpack?', 'No' );

			await act( async () => vi.advanceTimersByTime( 700 ) );

			expect(
				screen.getByRole( 'button', {
					name: 'Edit question 1 of 3: Install Jetpack?. Selected answer: No',
				} )
			).toBeInTheDocument();
			expect( screen.getByText( 'Asking question 2 of 3' ) ).toBeInTheDocument();
			expect( screen.getByText( 'Activate dark mode?' ) ).toBeInTheDocument();
		} finally {
			window.scrollBy = originalScrollBy;
			vi.useRealTimers();
		}
	} );

	it( 'scrolls a lone question into view when it is asked', async () => {
		vi.useFakeTimers();
		const scrollBy = vi.fn();
		const originalScrollBy = window.scrollBy;
		const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
		window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
		HTMLElement.prototype.getBoundingClientRect = vi.fn(
			() =>
				( {
					x: 0,
					y: window.innerHeight + 24,
					width: 100,
					height: 100,
					top: window.innerHeight + 24,
					right: 100,
					bottom: window.innerHeight + 124,
					left: 0,
					toJSON: () => {},
				} ) as DOMRect
		);
		try {
			const data = loadedSession( [
				agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
			] );

			renderInteractiveConversation( data, [ 'Install Jetpack?' ], vi.fn() );

			await act( async () => vi.advanceTimersByTime( 20 ) );

			// Without a scroll target the options sit under the composer, out of view.
			expect( scrollBy ).toHaveBeenCalledWith( {
				top: 220,
				behavior: 'smooth',
			} );
		} finally {
			window.scrollBy = originalScrollBy;
			HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
			vi.useRealTimers();
		}
	} );

	it( 'scrolls the newly active batched question into view', async () => {
		vi.useFakeTimers();
		const scrollBy = vi.fn();
		const originalScrollBy = window.scrollBy;
		const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
		window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
		HTMLElement.prototype.getBoundingClientRect = vi.fn(
			() =>
				( {
					x: 0,
					y: window.innerHeight + 24,
					width: 100,
					height: 100,
					top: window.innerHeight + 24,
					right: 100,
					bottom: window.innerHeight + 124,
					left: 0,
					toJSON: () => {},
				} ) as DOMRect
		);
		try {
			const data = loadedSession( [
				agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
				agentQuestionEntry( 'Activate dark mode?', [ 'Yes', 'No' ], 'q2' ),
			] );

			renderInteractiveConversation( data, [ 'Install Jetpack?', 'Activate dark mode?' ], vi.fn() );

			await act( async () => vi.advanceTimersByTime( 20 ) );
			scrollBy.mockClear();

			fireEvent.click( screen.getByRole( 'radio', { name: 'Yes' } ) );
			await act( async () => vi.advanceTimersByTime( 700 ) );
			await act( async () => vi.advanceTimersByTime( 20 ) );

			expect( screen.getByText( 'Asking question 2 of 2' ) ).toBeInTheDocument();
			expect( scrollBy ).toHaveBeenCalledWith( {
				top: 220,
				behavior: 'smooth',
			} );
		} finally {
			window.scrollBy = originalScrollBy;
			HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
			vi.useRealTimers();
		}
	} );

	it( 'skips delayed choreography and smooth scrolling for reduced motion', async () => {
		vi.useFakeTimers();
		reducedMotion.value = true;
		const scrollBy = vi.fn();
		const originalScrollBy = window.scrollBy;
		const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
		window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
		HTMLElement.prototype.getBoundingClientRect = vi.fn(
			() =>
				( {
					x: 0,
					y: window.innerHeight + 24,
					width: 100,
					height: 100,
					top: window.innerHeight + 24,
					right: 100,
					bottom: window.innerHeight + 124,
					left: 0,
					toJSON: () => {},
				} ) as DOMRect
		);
		try {
			const data = loadedSession( [
				agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
				agentQuestionEntry( 'Activate dark mode?', [ 'Yes', 'No' ], 'q2' ),
			] );

			renderInteractiveConversation( data, [ 'Install Jetpack?', 'Activate dark mode?' ], vi.fn() );

			await act( async () => vi.advanceTimersByTime( 20 ) );
			scrollBy.mockClear();

			fireEvent.click( screen.getByRole( 'radio', { name: 'Yes' } ) );
			await act( async () => vi.advanceTimersByTime( 20 ) );

			expect( screen.getByText( 'Asking question 2 of 2' ) ).toBeInTheDocument();
			expect( scrollBy ).toHaveBeenCalledWith( {
				top: 220,
				behavior: 'auto',
			} );
		} finally {
			window.scrollBy = originalScrollBy;
			HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
			reducedMotion.value = false;
			vi.useRealTimers();
		}
	} );

	it( 'renders submitted question batch summaries without reopening disabled answers', () => {
		const data = loadedSession( [
			agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
			agentQuestionEntry( 'Activate dark mode?', [ 'Yes', 'No' ], 'q2' ),
			askUserAnswerEntry( 'a1', 'No' ),
			askUserAnswerEntry( 'a2', 'Yes' ),
		] );

		renderConversation( data );

		expect( screen.getByText( 'Install Jetpack?' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Activate dark mode?' ) ).toBeInTheDocument();
		expect( screen.getByText( 'No' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Yes' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', {
				name: 'Edit question 1 of 2: Install Jetpack?. Selected answer: No',
			} )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', {
				name: 'Edit question 2 of 2: Activate dark mode?. Selected answer: Yes',
			} )
		).not.toBeInTheDocument();
		expect( screen.queryByText( 'Asking question 2 of 2' ) ).not.toBeInTheDocument();
	} );

	it( 'offers the free-form option the AskUserQuestion tool promises the model', () => {
		const onChooseFreeForm = vi.fn();
		const data = loadedSession( [
			agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
		] );

		renderConversation( data, {
			pendingQuestions: new Set( [ 'Install Jetpack?' ] ),
			onChooseFreeForm,
		} );

		const choice = screen.getByRole( 'radio', { name: 'Something else' } );
		expect( choice ).not.toBeChecked();

		fireEvent.click( choice );
		expect( onChooseFreeForm ).toHaveBeenCalledWith( 'Install Jetpack?' );
	} );

	it( 'marks the free-form option as armed once chosen', () => {
		const data = loadedSession( [
			agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
		] );

		renderConversation( data, {
			pendingQuestions: new Set( [ 'Install Jetpack?' ] ),
			freeFormQuestion: 'Install Jetpack?',
		} );

		expect( screen.getByRole( 'radio', { name: 'Something else' } ) ).toBeChecked();
	} );

	it( 'hides the free-form option once the batch is no longer interactive', () => {
		const data = loadedSession( [
			agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
		] );

		renderConversation( data );

		expect( screen.queryByRole( 'radio', { name: 'Something else' } ) ).not.toBeInTheDocument();
	} );

	it( 'does not duplicate a free-form option an off-contract model wrote itself', () => {
		const data = loadedSession( [
			agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'Something else' ], 'q1' ),
		] );

		renderConversation( data, { pendingQuestions: new Set( [ 'Install Jetpack?' ] ) } );

		expect( screen.getAllByRole( 'radio', { name: 'Something else' } ) ).toHaveLength( 1 );
	} );

	it( 'shows a typed answer as a message below the questions it answered', () => {
		const data = loadedSession( [
			agentQuestionEntry( 'Favorite color?', [ 'Blue', 'Green' ], 'q1' ),
			askUserAnswerEntry( 'a1', 'pink' ),
		] );

		renderConversation( data );

		expect( screen.getByText( 'pink' ) ).toBeInTheDocument();
	} );

	it( 'leaves a picked option to the question block rather than repeating it', () => {
		const data = loadedSession( [
			agentQuestionEntry( 'Favorite color?', [ 'Blue', 'Green' ], 'q1' ),
			askUserAnswerEntry( 'a1', 'Blue' ),
		] );

		renderConversation( data );

		expect( screen.getAllByText( 'Blue' ) ).toHaveLength( 1 );
	} );

	it( 'does not pass off the stop marker as something the user wrote', () => {
		const data = loadedSession( [
			agentQuestionEntry( 'Favorite color?', [ 'Blue', 'Green' ], 'q1' ),
			askUserAnswerEntry( 'a1', STOPPED_WITHOUT_ANSWER ),
		] );

		renderConversation( data );

		expect( screen.queryByText( STOPPED_WITHOUT_ANSWER ) ).not.toBeInTheDocument();
	} );

	it( 'pairs each typed answer with its own question in a batch', () => {
		const data = loadedSession( [
			agentQuestionEntry( 'Favorite color?', [ 'Blue', 'Green' ], 'q1' ),
			agentQuestionEntry( 'Favorite season?', [ 'Spring', 'Autumn' ], 'q2' ),
			askUserAnswerEntry( 'a1', 'Blue' ),
			askUserAnswerEntry( 'a2', 'monsoon' ),
		] );

		renderConversation( data );

		expect( screen.getByText( 'monsoon' ) ).toBeInTheDocument();
		expect( screen.getAllByText( 'Blue' ) ).toHaveLength( 1 );
	} );

	it( 'arms the composer from the escape hatch the model wrote itself', () => {
		const data = loadedSession( [
			agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'Something else' ], 'q1' ),
		] );
		const onChooseFreeForm = vi.fn();
		const onAnswerQuestion = vi.fn();

		renderConversation( data, {
			pendingQuestions: new Set( [ 'Install Jetpack?' ] ),
			onChooseFreeForm,
			onAnswerQuestion,
		} );

		fireEvent.click( screen.getByRole( 'radio', { name: 'Something else' } ) );

		expect( onChooseFreeForm ).toHaveBeenCalledWith( 'Install Jetpack?' );
		// Answering with the literal label tells the agent nothing, and it has to
		// ask what the user actually meant.
		expect( onAnswerQuestion ).not.toHaveBeenCalled();
	} );

	it( 'shows an answer typed into the composer as given', () => {
		const entry = agentQuestionEntry( 'Which pages?', [
			'Blog',
			'Contact',
			'Shop',
		] ) as SessionEntry & {
			data: object;
		};
		renderConversation(
			loadedSession( [
				{ ...entry, data: { ...entry.data, multiSelect: true } } as SessionEntry,
				askUserAnswerEntry( 'a1', 'Contact, Shop, A landing page' ),
			] )
		);

		expect( screen.getByText( 'Contact, Shop, A landing page' ) ).toBeInTheDocument();
	} );
} );
