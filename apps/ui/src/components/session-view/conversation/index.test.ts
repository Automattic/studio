import { STOPPED_WITHOUT_ANSWER } from '@studio/common/ai/tools';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	Conversation,
	entriesToRenderItems,
	entriesToTranscriptItems,
	getQuestionScrollDelta,
} from './index';
import type { LoadedAiSession, SessionEntry } from '@/data/core';
import type { StudioChatArtifactWidgetDraft } from '@studio/common/ai/chat-artifacts';

const connectorMocks = vi.hoisted( () => ( {
	readLocalMediaFile: vi.fn(),
	copyText: vi.fn( () => Promise.resolve() ),
} ) );

const reducedMotion = vi.hoisted( () => ( { value: false } ) );

vi.mock( '@wordpress/compose', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@wordpress/compose') >() ),
	useReducedMotion: () => reducedMotion.value,
} ) );

vi.mock( '@/components/markdown', () => ( {
	Markdown: ( { children }: { children: string } ) => children,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => connectorMocks,
} ) );

beforeEach( () => {
	connectorMocks.readLocalMediaFile.mockReset();
	connectorMocks.copyText.mockReset();
} );

describe( 'Assistant message copy button', () => {
	it( 'copies a whole reply from every reply, not just the newest', () => {
		renderConversation(
			loadedSession( [
				assistantTextEntry( 'Earlier reply.' ),
				assistantTextEntry( 'First part.', 'Second part.' ),
			] )
		);

		const buttons = screen.getAllByRole( 'button', { name: 'Copy message' } );
		expect( buttons ).toHaveLength( 2 );
		expect( screen.getByText( 'First part.' ).closest( '[data-message-text]' ) ).toHaveAttribute(
			'data-message-text',
			'First part.\n\nSecond part.'
		);

		fireEvent.click( buttons[ 1 ] );
		expect( connectorMocks.copyText ).toHaveBeenCalledWith( 'First part.\n\nSecond part.' );
	} );

	it( 'copies a prompt the user sent', () => {
		renderConversation( loadedSession( [ promptEntry( 'Hello there' ) ] ) );

		fireEvent.click( screen.getByRole( 'button', { name: 'Copy message' } ) );
		expect( connectorMocks.copyText ).toHaveBeenCalledWith( 'Hello there' );
	} );
} );

describe( 'Conversation tool rows', () => {
	it( 'keeps tool inputs and results hidden until the label row is clicked', async () => {
		const data = loadedSession( [
			assistantToolCallEntry( 'Bash', { command: 'npm test' } ),
			toolResultEntry( 'first output line\nsecond output line' ),
		] );

		renderConversation( data );

		expect( screen.queryByText( 'npm test' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( /first output line/ ) ).not.toBeInTheDocument();

		openActivity();
		const toolRow = screen.getByRole( 'button', { name: 'Run terminal command' } );
		expect( toolRow ).toHaveAttribute( 'aria-expanded', 'false' );

		fireEvent.click( toolRow );

		expect( toolRow ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( screen.getByText( 'npm test' ) ).toBeInTheDocument();
		expect( screen.getByText( /first output line/ ) ).toBeInTheDocument();

		fireEvent.click( toolRow );

		expect( toolRow ).toHaveAttribute( 'aria-expanded', 'false' );
		await waitFor( () =>
			expect( screen.queryByText( /first output line/ ) ).not.toBeInTheDocument()
		);
	} );

	it( 'opens a failed tool row with its error, without terminal color codes', () => {
		const escape = String.fromCharCode( 27 );
		renderConversation(
			loadedSession( [
				assistantToolCallEntry( 'Bash', { command: 'npm test' } ),
				toolResultEntry( `${ escape }[31mcommand failed${ escape }[0m`, true ),
			] )
		);
		openActivity();

		expect( screen.getByRole( 'button', { name: 'Run terminal command' } ) ).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		expect( screen.getByText( 'command failed' ) ).toBeInTheDocument();
	} );

	it( 'shows long tool results in the opened details without an extra toggle', () => {
		const longOutput = Array.from(
			{ length: 13 },
			( _, index ) => `output line ${ index + 1 }`
		).join( '\n' );
		const data = loadedSession( [
			assistantToolCallEntry( 'Bash', { command: 'npm test' } ),
			toolResultEntry( longOutput ),
		] );

		renderConversation( data );

		openActivity();
		fireEvent.click( screen.getByRole( 'button', { name: 'Run terminal command' } ) );

		expect( screen.getByText( /output line 13/ ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Show more' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Show less' } ) ).not.toBeInTheDocument();
	} );

	it( 'uses WP-CLI summaries while preserving the raw command in details', () => {
		const command =
			'post list --post_type=post --post_status=publish --fields=ID,post_title --format=table';
		const data = loadedSession( [
			assistantToolCallEntry( 'wp_cli', { nameOrPath: "Shaun's Blog", command } ),
			toolResultEntry( 'ID\tpost_title\n1\tHello world' ),
		] );

		renderConversation( data );
		openActivity();

		const toolRow = screen.getByRole( 'button', { name: 'List published posts' } );
		expect( toolRow ).toBeInTheDocument();
		expect( screen.queryByText( /--fields=ID/ ) ).not.toBeInTheDocument();

		fireEvent.click( toolRow );

		expect(
			screen.getByText( ( content ) => content.includes( `wp ${ command }` ) )
		).toBeInTheDocument();
	} );

	it( 'combines the tool label and detail in the row accessible name', () => {
		const data = loadedSession( [
			assistantToolCallEntry( 'Read', { file_path: '/tmp/studio/app.tsx' } ),
		] );

		renderConversation( data );
		openActivity();

		expect( screen.getByRole( 'button', { name: 'Read studio/app.tsx' } ) ).toBeInTheDocument();
	} );

	it( 'hides the raw Ask User tool row while showing the question UI', () => {
		const data = loadedSession( [
			assistantToolCallEntry( 'AskUserQuestion', {
				questions: [
					{
						question: "What kind of vibe do you want for your blog's design?",
						options: [
							{ label: 'Minimal & Clean', description: '' },
							{ label: 'Warm & Cozy', description: '' },
						],
					},
				],
			} ),
			agentQuestionEntry( "What kind of vibe do you want for your blog's design?", [
				'Minimal & Clean',
				'Warm & Cozy',
			] ),
		] );

		renderConversation( data );

		expect( screen.queryByText( 'Ask user' ) ).not.toBeInTheDocument();
		expect(
			screen.getByText( "What kind of vibe do you want for your blog's design?" )
		).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Minimal & Clean' } ) ).toBeInTheDocument();
	} );

	it( 'hides legacy media payload markers from expanded tool details for any tool', () => {
		const data = loadedSession( [
			assistantToolCallEntry( 'take_screenshot', { url: 'http://localhost:8888/' } ),
			toolResultEntry(
				'Screenshot captured - desktop: captured full page (1248px tall).\n' +
					'mediaWidgetPayload={"type":"media","widgetProps":{"url":"file:///tmp/screenshot.jpg"}}'
			),
		] );

		renderConversation( data );
		openActivity();
		fireEvent.click( screen.getByRole( 'button', { name: 'Take screenshot' } ) );

		expect( screen.getByText( /Screenshot captured/ ) ).toBeInTheDocument();
		expect( screen.queryByText( /mediaWidgetPayload/ ) ).not.toBeInTheDocument();
	} );
} );

describe( 'Conversation chat artifacts', () => {
	it( 'renders local screenshot media artifacts inline', async () => {
		connectorMocks.readLocalMediaFile.mockResolvedValue( {
			name: 'screenshot-desktop.jpg',
			mimeType: 'image/jpeg',
			data: new Uint8Array( [ 1, 2, 3 ] ).buffer,
		} );
		const data = loadedSession( [
			chatArtifactEntry( [
				{
					type: 'media',
					widgetProps: {
						url: 'file:///tmp/studio-screenshot/screenshot-desktop.jpg',
						mediaKind: 'image',
						alt: 'Screenshot of http://localhost:8888/ (desktop)',
						mediaId: null,
						source: {
							type: 'local',
							path: '/tmp/studio-screenshot/screenshot-desktop.jpg',
							name: 'screenshot-desktop.jpg',
							mimeType: 'image/jpeg',
						},
					},
				},
			] ),
		] );

		renderConversation( data );

		const screenshot = await screen.findByRole( 'img', {
			name: 'Screenshot of http://localhost:8888/ (desktop)',
		} );
		expect( screenshot ).toHaveAttribute( 'src', 'data:image/jpeg;base64,AQID' );
		expect( connectorMocks.readLocalMediaFile ).toHaveBeenCalledWith(
			'/tmp/studio-screenshot/screenshot-desktop.jpg'
		);
	} );

	it( 'shows a fallback when reading the local file fails', async () => {
		connectorMocks.readLocalMediaFile.mockRejectedValue( new Error( 'gone' ) );
		const data = loadedSession( [ chatArtifactEntry( [ localScreenshotWidget() ] ) ] );

		renderConversation( data );

		expect( await screen.findByRole( 'status' ) ).toHaveTextContent( 'Image unavailable' );
	} );

	it( 'shows each annotation with its own images, and the rest on the first bubble', () => {
		const image = ( id: string ) => ( {
			kind: 'image' as const,
			id,
			name: `${ id }.png`,
			mimeType: 'image/png' as const,
			size: 1,
		} );
		const entry = {
			type: 'custom',
			id: 'annotated-prompt',
			parentId: null,
			timestamp: '2026-06-05T12:00:02.000Z',
			customType: 'studio.user_prompt',
			data: {
				text: 'Also check spacing',
				source: 'prompt',
				attachments: [ image( 'own' ), image( 'note' ), { kind: 'file', name: 'brief.md' } ],
				visualAnnotations: [
					{ comment: 'Also check spacing', imageIds: [ 'own' ] },
					{ comment: 'Use this photo', tag: 'img', imageIds: [ 'note' ] },
				],
			},
		} as unknown as SessionEntry;

		expect(
			entriesToRenderItems( [ entry ] ).map( ( item ) =>
				item.kind === 'user-text'
					? item.attachments?.map( ( attachment ) => attachment.name )
					: null
			)
		).toEqual( [ [ 'own.png', 'brief.md' ], [ 'note.png' ] ] );
	} );

	it( 'skips malformed chat artifact entries without crashing', () => {
		const malformed = [
			{ version: 1, id: 'artifact-1' }, // missing widgets
			{ version: 1, id: 'artifact-2', widgets: 'nope' }, // wrong widgets type
			{ id: 'artifact-3', widgets: [] }, // missing version
		];
		for ( const data of malformed ) {
			const entry = {
				type: 'custom',
				id: 'chat-artifact',
				parentId: null,
				timestamp: '2026-06-05T12:00:02.000Z',
				customType: 'studio.chat_artifact',
				data,
			} as unknown as SessionEntry;

			expect( entriesToRenderItems( [ entry ] ) ).toEqual( [] );
		}
	} );
} );

function localScreenshotWidget(): StudioChatArtifactWidgetDraft {
	return {
		type: 'media',
		widgetProps: {
			url: 'file:///tmp/studio-screenshot/screenshot-desktop.jpg',
			mediaKind: 'image',
			alt: 'Screenshot of http://localhost:8888/ (desktop)',
			mediaId: null,
			source: {
				type: 'local',
				path: '/tmp/studio-screenshot/screenshot-desktop.jpg',
				name: 'screenshot-desktop.jpg',
				mimeType: 'image/jpeg',
			},
		},
	};
}

describe( 'Conversation Ask User questions', () => {
	it( 'shows option descriptions and a selected historical answer', () => {
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

		expect( screen.getAllByRole( 'listitem' ) ).toHaveLength( 2 );
		expect(
			screen.getByText( 'Quiet typography, generous spacing, and simple structure.' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Large headlines, sharp contrast, and magazine-style pacing.' )
		).toBeInTheDocument();

		const pickedOption = screen.getByRole( 'button', { name: 'Bold & Editorial' } );
		expect( pickedOption ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( pickedOption ).toBeDisabled();
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

		fireEvent.click( screen.getByRole( 'button', { name: 'Shop' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Blog' } ) );
		expect( onAnswerQuestion ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Confirm' } ) );
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

			fireEvent.click( screen.getByRole( 'button', { name: 'Yes' } ) );

			expect( onAnswerQuestion ).toHaveBeenCalledWith( 'Install Jetpack?', 'Yes' );
			expect( screen.getByRole( 'button', { name: 'Yes' } ) ).toHaveAttribute(
				'aria-pressed',
				'true'
			);
			expect( screen.queryByText( 'Activate dark mode?' ) ).not.toBeInTheDocument();

			await act( async () => vi.advanceTimersByTime( 700 ) );
			await act( async () => vi.advanceTimersByTime( 20 ) );

			const answeredSummary = screen.getByRole( 'button', {
				name: 'Edit question 1 of 3: Install Jetpack?. Selected answer: Yes',
			} );
			const activeQuestion = screen.getByText( 'Activate dark mode?' ).closest( '[tabindex="-1"]' );
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
			expect( screen.getByRole( 'button', { name: 'Yes' } ) ).toHaveAttribute(
				'aria-pressed',
				'true'
			);
			expect( screen.queryByText( 'Activate dark mode?' ) ).not.toBeInTheDocument();

			fireEvent.click( screen.getByRole( 'button', { name: 'No' } ) );
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

			fireEvent.click( screen.getByRole( 'button', { name: 'Yes' } ) );
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

			fireEvent.click( screen.getByRole( 'button', { name: 'Yes' } ) );
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

		const button = screen.getByRole( 'button', { name: 'Something else' } );
		expect( button ).toHaveAttribute( 'aria-pressed', 'false' );

		fireEvent.click( button );
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

		expect( screen.getByRole( 'button', { name: 'Something else' } ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	} );

	it( 'hides the free-form option once the batch is no longer interactive', () => {
		const data = loadedSession( [
			agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
		] );

		renderConversation( data );

		expect( screen.queryByRole( 'button', { name: 'Something else' } ) ).not.toBeInTheDocument();
	} );

	it( 'does not duplicate a free-form option an off-contract model wrote itself', () => {
		const data = loadedSession( [
			agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'Something else' ], 'q1' ),
		] );

		renderConversation( data, { pendingQuestions: new Set( [ 'Install Jetpack?' ] ) } );

		expect( screen.getAllByRole( 'button', { name: 'Something else' } ) ).toHaveLength( 1 );
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

		fireEvent.click( screen.getByRole( 'button', { name: 'Something else' } ) );

		expect( onChooseFreeForm ).toHaveBeenCalledWith( 'Install Jetpack?' );
		// Answering with the literal label tells the agent nothing, and it has to
		// ask what the user actually meant.
		expect( onAnswerQuestion ).not.toHaveBeenCalled();
	} );

	it( 'resolves picked answers positionally for a multi-question batch', () => {
		const items = entriesToRenderItems( [
			agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
			agentQuestionEntry( 'Activate dark mode?', [ 'Yes', 'No' ], 'q2' ),
			askUserAnswerEntry( 'a1', 'No' ),
			askUserAnswerEntry( 'a2', 'Yes' ),
		] );

		expect( items ).toMatchObject( [
			{
				kind: 'agent-question-batch',
				questions: [
					{ question: 'Install Jetpack?', pickedLabel: 'No' },
					{ question: 'Activate dark mode?', pickedLabel: 'Yes' },
				],
			},
		] );
	} );

	it( 'highlights no answer when a question batch has fewer answers than questions', () => {
		const items = entriesToRenderItems( [
			agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
			agentQuestionEntry( 'Activate dark mode?', [ 'Yes', 'No' ], 'q2' ),
			askUserAnswerEntry( 'a1', 'Yes' ),
		] );

		expect( items ).toMatchObject( [
			{
				kind: 'agent-question-batch',
				questions: [
					{ question: 'Install Jetpack?', pickedLabel: undefined },
					{ question: 'Activate dark mode?', pickedLabel: undefined },
				],
			},
		] );
	} );

	it( 'shows the typed part of an answer next to the picked options', () => {
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

		expect( screen.getByRole( 'button', { name: 'Shop' } ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect( screen.getByText( 'A landing page' ) ).toBeInTheDocument();
	} );
} );

describe( 'Conversation turn-closed markers', () => {
	it( 'renders an error marker with the persisted message for errored turns', () => {
		const items = entriesToRenderItems( [
			turnClosedEntry( 'error', 'Monthly usage limit reached: 429 {"type":"error"}' ),
		] );

		expect( items ).toMatchObject( [
			{ kind: 'error-marker', message: 'Monthly usage limit reached: 429 {"type":"error"}' },
		] );
	} );

	it( 'renders no marker for successful turns', () => {
		expect( entriesToRenderItems( [ turnClosedEntry( 'success' ) ] ) ).toEqual( [] );
	} );

	it( 'strips terminal color codes from error markers', () => {
		const escape = String.fromCharCode( 27 );
		const items = entriesToRenderItems( [
			turnClosedEntry( 'error', `${ escape }[31mBuild failed${ escape }[0m` ),
		] );

		expect( items ).toMatchObject( [ { kind: 'error-marker', message: 'Build failed' } ] );
	} );
} );

describe( 'Conversation turn activity', () => {
	it( 'folds the tool calls and the text between them into one line before the reply', () => {
		const items = entriesToTranscriptItems( [
			promptEntry( 'Go' ),
			assistantToolCallEntry( 'Read', { file_path: '/tmp/a.txt' }, 'Let me look.' ),
			toolResultEntry( 'contents' ),
			agentQuestionEntry( 'Which one?', [ 'A', 'B' ] ),
			assistantTextEntry( 'Done.' ),
			turnClosedEntry( 'success' ),
		] );

		expect( items ).toMatchObject( [
			{ kind: 'user-text', text: 'Go' },
			{
				kind: 'activity',
				status: 'success',
				startedAt: Date.parse( '2026-06-05T12:00:00.000Z' ),
				endedAt: Date.parse( '2026-06-05T12:00:03.000Z' ),
				items: [ { kind: 'assistant-text', text: 'Let me look.' }, { kind: 'tool-use' } ],
			},
			{ kind: 'agent-question-batch' },
			{ kind: 'assistant-text', text: 'Done.' },
		] );
	} );

	it( 'marks a stopped turn before its marker', () => {
		expect(
			entriesToTranscriptItems( [ promptEntry( 'Go' ), turnClosedEntry( 'interrupted' ) ] )
		).toMatchObject( [
			{ kind: 'user-text' },
			{ kind: 'activity', status: 'interrupted', items: [] },
			{ kind: 'interrupted-marker' },
		] );
	} );

	it( 'counts the open turn from the live run while the agent works', () => {
		const items = entriesToTranscriptItems( [ promptEntry( 'Go' ) ], {
			running: true,
			startedAt: 42,
		} );

		expect( items[ 1 ] ).toMatchObject( {
			kind: 'activity',
			status: 'running',
			startedAt: 42,
			endedAt: null,
		} );
	} );

	it( 'shimmers the working line and the running tool until they finish', () => {
		renderConversation(
			loadedSession( [ promptEntry( 'Go' ), assistantToolCallEntry( 'Bash', { command: 'ls' } ) ] ),
			{ isRunning: true, startedAt: Date.now() }
		);

		const line = screen.getByRole( 'button', { name: 'Working for 0s' } );
		expect( screen.getByText( 'Working for 0s' ) ).toHaveClass( 'studio-shimmer' );
		expect( line ).toHaveAttribute( 'aria-expanded', 'false' );

		fireEvent.click( line );
		expect( line ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( screen.getByText( 'Run terminal command' ) ).toHaveClass( 'studio-shimmer' );
	} );
} );

describe( 'getQuestionScrollDelta', () => {
	// The scroller spans the full column, so its bottom sits *under* the
	// floating composer. `reservedBottomSpace` is the scroller padding holding
	// content clear of the composer plus the column's own trailing space, so a
	// card settles where scrolling to the bottom would put it rather than flush.
	// Column runs 0-800 with a 120px composer and 20px of trailing space.
	const container = { containerTop: 0, containerBottom: 800, reservedBottomSpace: 140 };

	it( 'scrolls a question hidden behind the composer fully clear of it', () => {
		// Card ends at 700, i.e. 40px below the composer's top edge at 660.
		const delta = getQuestionScrollDelta( {
			...container,
			elementTop: 500,
			elementBottom: 700,
		} );

		expect( delta ).toBe( 40 );
		expect( 700 - delta ).toBeLessThanOrEqual( 800 - 140 );
	} );

	it( 'leaves a question that already clears the composer alone', () => {
		expect( getQuestionScrollDelta( { ...container, elementTop: 400, elementBottom: 600 } ) ).toBe(
			0
		);
	} );

	it( 'scrolls up to a question cut off at the top, ignoring the bottom clearance', () => {
		expect( getQuestionScrollDelta( { ...container, elementTop: 4, elementBottom: 300 } ) ).toBe(
			-8
		);
	} );
} );

describe( 'Conversation visual annotations', () => {
	it( 'renders each submitted annotation as its own user turn', () => {
		const items = entriesToRenderItems( [
			visualAnnotationsEntry( [
				{ comment: 'Make this smaller', tag: 'h1', nearbyText: 'Welcome' },
				{ comment: 'Use a different image', elementLabel: 'img#hero' },
			] ),
		] );

		expect( items ).toMatchObject( [
			{
				kind: 'user-text',
				text: 'Make this smaller',
				annotation: { tag: 'h1', nearbyText: 'Welcome' },
			},
			{
				kind: 'user-text',
				text: 'Use a different image',
				annotation: { elementLabel: 'img#hero' },
			},
		] );
	} );
} );

function visualAnnotationsEntry(
	visualAnnotations: Array< {
		comment: string;
		tag?: string;
		elementLabel?: string;
		nearbyText?: string;
	} >
): SessionEntry {
	return {
		type: 'custom',
		id: 'visual-annotations',
		parentId: null,
		timestamp: '2026-06-05T12:00:03.000Z',
		customType: 'studio.user_prompt',
		data: {
			text: `${ visualAnnotations.length } annotations submitted`,
			source: 'prompt',
			visualAnnotations,
		},
	} as SessionEntry;
}

function promptEntry( text: string ): SessionEntry {
	return {
		type: 'custom',
		id: `prompt-${ text }`,
		parentId: null,
		timestamp: '2026-06-05T12:00:00.000Z',
		customType: 'studio.user_prompt',
		data: { text, source: 'prompt' },
	} as SessionEntry;
}

function turnClosedEntry( status: string, errorMessage?: string ): SessionEntry {
	return {
		type: 'custom',
		id: `turn-closed-${ status }`,
		parentId: null,
		timestamp: '2026-06-05T12:00:03.000Z',
		customType: 'studio.turn_closed',
		data: { status, ...( errorMessage !== undefined ? { errorMessage } : {} ) },
	} as SessionEntry;
}

interface RenderConversationOptions {
	isRunning?: boolean;
	startedAt?: number | null;
	pendingQuestions?: Set< string >;
	pendingAnswers?: Record< string, string >;
	freeFormQuestion?: string | null;
	onAnswerQuestion?: ( question: string, label: string ) => void;
	onChooseFreeForm?: ( question: string ) => void;
}

function renderConversation( data: LoadedAiSession, options: RenderConversationOptions = {} ) {
	const queryClient = new QueryClient( {
		defaultOptions: { queries: { retry: false } },
	} );
	return render(
		createElement(
			QueryClientProvider,
			{ client: queryClient },
			createElement( Conversation, {
				data,
				isRunning: options.isRunning ?? false,
				startedAt: options.startedAt ?? null,
				pendingQuestions: options.pendingQuestions ?? new Set< string >(),
				pendingAnswers: options.pendingAnswers ?? {},
				freeFormQuestion: options.freeFormQuestion ?? null,
				onAnswerQuestion: options.onAnswerQuestion ?? vi.fn(),
				onChooseFreeForm: options.onChooseFreeForm ?? vi.fn(),
			} )
		)
	);
}

function renderInteractiveConversation(
	data: LoadedAiSession,
	pendingQuestionTexts: string[],
	onAnswerQuestion: ( question: string, label: string ) => void
) {
	return render(
		createElement( InteractiveConversation, {
			data,
			pendingQuestionTexts,
			onAnswerQuestion,
		} )
	);
}

function InteractiveConversation( {
	data,
	pendingQuestionTexts,
	onAnswerQuestion,
}: {
	data: LoadedAiSession;
	pendingQuestionTexts: string[];
	onAnswerQuestion: ( question: string, label: string ) => void;
} ) {
	const [ pendingAnswers, setPendingAnswers ] = useState< Record< string, string > >( {} );

	return createElement( Conversation, {
		data,
		isRunning: false,
		startedAt: null,
		pendingQuestions: new Set( pendingQuestionTexts ),
		pendingAnswers,
		freeFormQuestion: null,
		onAnswerQuestion: ( question, label ) => {
			onAnswerQuestion( question, label );
			setPendingAnswers( ( answers ) => ( { ...answers, [ question ]: label } ) );
		},
		onChooseFreeForm: () => {},
	} );
}

function openActivity() {
	fireEvent.click( screen.getByRole( 'button', { name: /^Worked/ } ) );
}

function loadedSession( entries: SessionEntry[] ): LoadedAiSession {
	return {
		summary: {
			id: 'session-1',
			filePath: '/tmp/session-1.json',
			createdAt: '2026-06-05T12:00:00.000Z',
			updatedAt: '2026-06-05T12:00:00.000Z',
			activeEnvironment: 'local',
			eventCount: entries.length,
		},
		entries,
	};
}

function assistantTextEntry( ...texts: string[] ): SessionEntry {
	return {
		type: 'message',
		id: `assistant-${ texts[ 0 ] }`,
		parentId: null,
		timestamp: '2026-06-05T12:00:02.000Z',
		message: { role: 'assistant', content: texts.map( ( text ) => ( { type: 'text', text } ) ) },
	} as unknown as SessionEntry;
}

function assistantToolCallEntry(
	name: string,
	args: Record< string, unknown > = {},
	text?: string
): SessionEntry {
	return {
		type: 'message',
		id: `assistant-${ name }`,
		parentId: null,
		timestamp: '2026-06-05T12:00:00.000Z',
		message: {
			role: 'assistant',
			content: [
				...( text ? [ { type: 'text', text } ] : [] ),
				{
					type: 'toolCall',
					id: 'tool-call-1',
					name,
					arguments: args,
				},
			],
		},
	} as unknown as SessionEntry;
}

function toolResultEntry( text: string, isError = false ): SessionEntry {
	return {
		type: 'message',
		id: 'tool-result',
		parentId: null,
		timestamp: '2026-06-05T12:00:01.000Z',
		message: {
			role: 'toolResult',
			toolCallId: 'tool-call-1',
			content: [ { type: 'text', text } ],
			isError,
		},
	} as unknown as SessionEntry;
}

function agentQuestionEntry(
	question: string,
	options: Array< string | { label: string; description: string } >,
	id = 'question',
	selectedLabel?: string
): SessionEntry {
	return {
		type: 'custom',
		id,
		parentId: null,
		timestamp: '2026-06-05T12:00:01.000Z',
		customType: 'studio.agent_question',
		data: {
			question,
			options: options.map( ( option ) =>
				typeof option === 'string' ? { label: option, description: '' } : option
			),
			...( selectedLabel ? { selectedLabel } : {} ),
		},
	} as SessionEntry;
}

function chatArtifactEntry( widgets: StudioChatArtifactWidgetDraft[] ): SessionEntry {
	return {
		type: 'custom',
		id: 'chat-artifact',
		parentId: null,
		timestamp: '2026-06-05T12:00:02.000Z',
		customType: 'studio.chat_artifact',
		data: {
			version: 1,
			id: 'artifact-1',
			widgets,
		},
	} as SessionEntry;
}

function askUserAnswerEntry( id: string, text: string ): SessionEntry {
	return {
		type: 'custom',
		id,
		parentId: null,
		timestamp: '2026-06-05T12:00:02.000Z',
		customType: 'studio.user_prompt',
		data: {
			text,
			source: 'ask_user',
		},
	} as SessionEntry;
}
