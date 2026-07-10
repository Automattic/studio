import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { cloneElement, createElement, useState, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/data/app-messages';
import { Conversation, entriesToRenderItems } from './index';
import type { LoadedAiSession, SessionEntry } from '@/data/core';
import type { StudioChatArtifactWidgetDraft } from '@studio/common/ai/chat-artifacts';

const connectorMocks = vi.hoisted( () => ( {
	readLocalMediaFile: vi.fn(),
	copyText: vi.fn(),
	capabilities: { readLocalMedia: true },
} ) );

vi.mock( '@/components/markdown', () => ( {
	Markdown: ( { children }: { children: string } ) => children,
} ) );

vi.mock( '@/data/app-messages', () => ( {
	toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => connectorMocks,
} ) );

// Minimal stand-ins for the wpds primitives: plain buttons that keep the
// DOM props (className, aria-*, onClick) and drop the wpds-only ones.
type MockButtonProps = {
	children?: ReactNode;
	label?: string;
	icon?: unknown;
	variant?: string;
	nativeButton?: boolean;
	render?: unknown;
} & Record< string, unknown >;

vi.mock( '@wordpress/ui', () => {
	function mergeRenderProps(
		render: ReactElement,
		props: Record< string, unknown >,
		children: ReactNode
	) {
		return cloneElement( render as ReactElement< Record< string, unknown > >, {
			...props,
			...( typeof render.props === 'object' && render.props !== null ? render.props : {} ),
			children:
				children ??
				( typeof render.props === 'object' && render.props !== null && 'children' in render.props
					? ( render.props as { children?: ReactNode } ).children
					: undefined ),
		} );
	}

	return {
		Icon: () => null,
		Button: ( {
			children,
			variant: _v,
			nativeButton: _n,
			render: _r,
			...props
		}: MockButtonProps ) => createElement( 'button', { type: 'button', ...props }, children ),
		IconButton: ( {
			label,
			icon: _i,
			variant: _v,
			nativeButton: _n,
			render: _r,
			...props
		}: MockButtonProps ) =>
			createElement( 'button', { type: 'button', 'aria-label': label, ...props } ),
		Tooltip: {
			Root: ( { children }: { children?: ReactNode } ) => children,
			Trigger: ( {
				children,
				render,
				...props
			}: {
				children?: ReactNode;
				render?: ReactElement;
			} & Record< string, unknown > ) =>
				render ? mergeRenderProps( render, props, children ) : children,
			Positioner: () => null,
			Popup: () => null,
			Provider: ( { children }: { children?: ReactNode } ) => children,
		},
	};
} );

beforeEach( () => {
	connectorMocks.readLocalMediaFile.mockReset();
	connectorMocks.copyText.mockReset();
	connectorMocks.capabilities.readLocalMedia = true;
} );

describe( 'Assistant message copy button', () => {
	it( 'copies the full message when text blocks are split by tool calls', () => {
		const data = loadedSession( [
			{
				type: 'message',
				id: 'assistant-multi-block',
				parentId: null,
				timestamp: '2026-06-05T12:00:00.000Z',
				message: {
					role: 'assistant',
					content: [
						{ type: 'text', text: 'First part.' },
						{ type: 'toolCall', id: 'tool-call-1', name: 'Bash', arguments: {} },
						{ type: 'text', text: 'Second part.' },
					],
				},
			} as unknown as SessionEntry,
		] );
		renderConversation( data );

		const buttons = screen.getAllByRole( 'button', { name: 'Copy message' } );
		expect( buttons ).toHaveLength( 1 );

		fireEvent.click( buttons[ 0 ] );
		expect( connectorMocks.copyText ).toHaveBeenCalledWith( 'First part.\n\nSecond part.' );
	} );

	it( 'copies the message on double-click and shows a notice', () => {
		const data = loadedSession( [
			{
				type: 'message',
				id: 'assistant-single',
				parentId: null,
				timestamp: '2026-06-05T12:00:00.000Z',
				message: {
					role: 'assistant',
					content: [ { type: 'text', text: 'Plain reply.' } ],
				},
			} as unknown as SessionEntry,
		] );
		renderConversation( data );

		fireEvent.doubleClick( screen.getByText( 'Plain reply.' ) );

		expect( connectorMocks.copyText ).toHaveBeenCalledWith( 'Plain reply.' );
		expect( toast.success ).toHaveBeenCalledWith( 'Copied', { id: 'copy-feedback' } );
	} );

	it( 'does not add a copy button to user messages', () => {
		const data = loadedSession( [
			{
				type: 'message',
				id: 'user-1',
				parentId: null,
				timestamp: '2026-06-05T12:00:00.000Z',
				message: {
					role: 'user',
					content: [ { type: 'text', text: 'Hello there' } ],
				},
			} as unknown as SessionEntry,
		] );
		renderConversation( data );

		expect( screen.queryByRole( 'button', { name: 'Copy message' } ) ).not.toBeInTheDocument();
	} );
} );

describe( 'Conversation tool rows', () => {
	function expandWorkPhase( label: string | RegExp ) {
		fireEvent.click( screen.getByRole( 'button', { name: label } ) );
	}

	it( 'keeps tool inputs and results hidden until the label row is clicked', () => {
		const data = loadedSession( [
			assistantToolCallEntry( 'Bash', { command: 'npm test' } ),
			toolResultEntry( 'first output line\nsecond output line' ),
		] );

		renderConversation( data );

		expect( screen.queryByText( 'npm test' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( /first output line/ ) ).not.toBeInTheDocument();

		expandWorkPhase( 'Ran 1 command' );
		const toolRow = screen.getByRole( 'button', { name: 'Run terminal command' } );
		expect( toolRow ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( toolRow ).toHaveAttribute( 'data-expanded', 'false' );

		fireEvent.click( toolRow );

		expect( toolRow ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( toolRow ).toHaveAttribute( 'data-expanded', 'true' );
		expect( screen.getByText( 'npm test' ) ).toBeInTheDocument();
		expect( screen.getByText( /first output line/ ) ).toBeInTheDocument();

		fireEvent.click( toolRow );

		expect( toolRow ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( toolRow ).toHaveAttribute( 'data-expanded', 'false' );
		const hiddenDetails = screen
			.getByText( /second output line/ )
			.closest( '[aria-hidden="true"]' );
		expect( hiddenDetails ).toBeInTheDocument();
		fireEvent.transitionEnd( hiddenDetails! );
		expect( screen.queryByText( /second output line/ ) ).not.toBeInTheDocument();
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

		expect( screen.queryByRole( 'button', { name: 'Show more' } ) ).not.toBeInTheDocument();

		expandWorkPhase( 'Ran 1 command' );
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

		expandWorkPhase( 'Ran 1 WP-CLI command' );
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

		expandWorkPhase( 'Read 1 file' );
		expect( screen.getByRole( 'button', { name: 'Read studio/app.tsx' } ) ).toHaveAttribute(
			'aria-label',
			'Read studio/app.tsx'
		);
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
		expandWorkPhase( /Used 1 tool|Take screenshot|Captured/ );
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

		fireEvent.click( screen.getByRole( 'button', { name: 'Captured 1 artifact' } ) );

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

		fireEvent.click( screen.getByRole( 'button', { name: 'Captured 1 artifact' } ) );

		expect( await screen.findByRole( 'status' ) ).toHaveTextContent( 'Image unavailable' );
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

	it( 'drops local-only media widgets when the connector cannot read local files', () => {
		const localOnly = chatArtifactEntry( [ localScreenshotWidget() ] );
		const remote = chatArtifactEntry( [
			{
				type: 'media',
				widgetProps: {
					url: 'https://example.com/capture.jpg',
					mediaKind: 'image',
					alt: 'Remote capture',
					mediaId: null,
				},
			},
		] );

		expect( entriesToRenderItems( [ localOnly ], { canReadLocalMedia: false } ) ).toEqual( [] );
		expect( entriesToRenderItems( [ remote ], { canReadLocalMedia: false } ) ).toHaveLength( 1 );
		expect( entriesToRenderItems( [ localOnly ], { canReadLocalMedia: true } ) ).toHaveLength( 1 );
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
		const restoreMatchMedia = mockPrefersReducedMotion( true );
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
			restoreMatchMedia();
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
} );

interface RenderConversationOptions {
	isRunning?: boolean;
	startedAt?: number | null;
	pendingQuestions?: Set< string >;
	pendingAnswers?: Record< string, string >;
	onAnswerQuestion?: ( question: string, label: string ) => void;
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
				activeTool: null,
				pendingQuestions: options.pendingQuestions ?? new Set< string >(),
				pendingAnswers: options.pendingAnswers ?? {},
				pendingPermissions: new Set< string >(),
				answeredPermissions: {},
				onAnswerQuestion: options.onAnswerQuestion ?? vi.fn(),
				onAnswerPermission: vi.fn(),
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
		activeTool: null,
		pendingQuestions: new Set( pendingQuestionTexts ),
		pendingAnswers,
		pendingPermissions: new Set< string >(),
		answeredPermissions: {},
		onAnswerQuestion: ( question, label ) => {
			onAnswerQuestion( question, label );
			setPendingAnswers( ( answers ) => ( { ...answers, [ question ]: label } ) );
		},
		onAnswerPermission: () => {},
	} );
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

function assistantToolCallEntry(
	name: string,
	args: Record< string, unknown > = {}
): SessionEntry {
	return {
		type: 'message',
		id: `assistant-${ name }`,
		parentId: null,
		timestamp: '2026-06-05T12:00:00.000Z',
		message: {
			role: 'assistant',
			content: [
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

function toolResultEntry( text: string ): SessionEntry {
	return {
		type: 'message',
		id: 'tool-result',
		parentId: null,
		timestamp: '2026-06-05T12:00:01.000Z',
		message: {
			role: 'toolResult',
			toolCallId: 'tool-call-1',
			content: [ { type: 'text', text } ],
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

function mockPrefersReducedMotion( matches: boolean ) {
	const originalMatchMedia = window.matchMedia;
	const mutableWindow = window as unknown as { matchMedia?: typeof window.matchMedia };
	mutableWindow.matchMedia = vi.fn(
		( query: string ) =>
			( {
				matches: query === '(prefers-reduced-motion: reduce)' ? matches : false,
				media: query,
				onchange: null,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				addListener: vi.fn(),
				removeListener: vi.fn(),
				dispatchEvent: vi.fn(),
			} ) as unknown as MediaQueryList
	);

	return () => {
		if ( originalMatchMedia ) {
			mutableWindow.matchMedia = originalMatchMedia;
			return;
		}
		delete mutableWindow.matchMedia;
	};
}

function assistantThinkingEntry( thinking: string ): SessionEntry {
	return {
		type: 'message',
		id: 'assistant-thinking',
		parentId: null,
		timestamp: '2026-06-05T12:00:00.000Z',
		message: {
			role: 'assistant',
			content: [
				{ type: 'thinking', thinking },
				{ type: 'text', text: 'The final answer.' },
			],
		},
	} as unknown as SessionEntry;
}

describe( 'Conversation thinking rows', () => {
	it( 'folds thinking into a work phase before the answer text', () => {
		const items = entriesToRenderItems( [ assistantThinkingEntry( 'Weighing two options.' ) ] );
		expect( items.map( ( item ) => item.kind ) ).toEqual( [ 'work-phase', 'assistant-text' ] );
		if ( items[ 0 ]?.kind === 'work-phase' ) {
			expect( items[ 0 ].steps.map( ( step ) => step.kind ) ).toEqual( [ 'thinking' ] );
		}
	} );

	it( 'drops whitespace-only thinking blocks', () => {
		const items = entriesToRenderItems( [ assistantThinkingEntry( '   \n  ' ) ] );
		expect( items.map( ( item ) => item.kind ) ).toEqual( [ 'assistant-text' ] );
	} );

	it( 'labels the work phase with the duration derived from entry timestamps', () => {
		const prior = {
			type: 'custom',
			id: 'prompt-entry',
			parentId: null,
			timestamp: '2026-06-05T11:59:57.000Z',
			customType: 'studio.user_prompt',
			data: { text: 'Question', source: 'prompt' },
		} as unknown as SessionEntry;
		const data = loadedSession( [ prior, assistantThinkingEntry( 'Reasoning.' ) ] );

		renderConversation( data );

		expect( screen.getByRole( 'button', { name: 'Thought for 3s' } ) ).toBeInTheDocument();
	} );

	it( 'keeps the reasoning hidden until the work phase is expanded', () => {
		const data = loadedSession( [
			assistantThinkingEntry( 'First reasoning line.\nSecond reasoning line.' ),
		] );

		renderConversation( data );

		expect( screen.queryByText( /Second reasoning line/ ) ).not.toBeInTheDocument();

		const phaseRow = screen.getByRole( 'button', { name: 'Thinking…' } );
		expect( phaseRow ).toHaveAttribute( 'aria-expanded', 'false' );

		fireEvent.click( phaseRow );

		const thinkingRow = screen.getAllByRole( 'button', { name: 'Thinking…' } )[ 1 ];
		fireEvent.click( thinkingRow );

		expect( screen.getByText( /Second reasoning line/ ) ).toBeInTheDocument();
	} );
} );

describe( 'Conversation work phases', () => {
	it( 'folds a single tool into a work-phase row', () => {
		const items = entriesToRenderItems( [
			assistantToolCallEntry( 'Read', { file_path: '/tmp/studio/app.tsx' } ),
		] );
		expect( items ).toHaveLength( 1 );
		expect( items[ 0 ]?.kind ).toBe( 'work-phase' );
		if ( items[ 0 ]?.kind === 'work-phase' ) {
			expect( items[ 0 ].steps ).toHaveLength( 1 );
			expect( items[ 0 ].summary.label ).toContain( 'Read 1 file' );
		}
	} );

	it( 'collapses thinking and tools across iterations into one work phase', () => {
		const items = entriesToRenderItems( [
			{
				type: 'message',
				id: 'assistant-1',
				parentId: null,
				timestamp: '2026-06-05T12:00:00.000Z',
				message: {
					role: 'assistant',
					content: [
						{ type: 'thinking', thinking: 'Explore first.' },
						{ type: 'toolCall', id: 'tool-1', name: 'Ls', arguments: { path: '/tmp/pages' } },
						{ type: 'toolCall', id: 'tool-2', name: 'Read', arguments: { file_path: '/tmp/a' } },
					],
				},
			} as unknown as SessionEntry,
			{
				type: 'message',
				id: 'assistant-2',
				parentId: null,
				timestamp: '2026-06-05T12:00:10.000Z',
				message: {
					role: 'assistant',
					content: [
						{ type: 'thinking', thinking: 'Now write.' },
						{ type: 'toolCall', id: 'tool-3', name: 'Write', arguments: { file_path: '/tmp/b' } },
						{ type: 'text', text: 'Done with the plugin scaffold.' },
					],
				},
			} as unknown as SessionEntry,
		] );
		expect( items.map( ( item ) => item.kind ) ).toEqual( [ 'work-phase', 'assistant-text' ] );
		if ( items[ 0 ]?.kind === 'work-phase' ) {
			expect( items[ 0 ].steps.map( ( step ) => step.kind ) ).toEqual( [
				'thinking',
				'tool-use',
				'tool-use',
				'thinking',
				'tool-use',
			] );
			expect( items[ 0 ].summary.label ).toContain( 'Edited 1 file' );
			expect( items[ 0 ].summary.label ).toContain( 'Read 1 file' );
			expect( items[ 0 ].summary.label ).toContain( 'Explored 1 path' );
		}
	} );

	it( 'flushes the work phase before assistant text, then starts a new phase', () => {
		const items = entriesToRenderItems( [
			{
				type: 'message',
				id: 'assistant-mixed',
				parentId: null,
				timestamp: '2026-06-05T12:00:00.000Z',
				message: {
					role: 'assistant',
					content: [
						{ type: 'toolCall', id: 'tool-1', name: 'Read', arguments: { file_path: '/a' } },
						{ type: 'text', text: 'Found the template.' },
						{ type: 'toolCall', id: 'tool-2', name: 'Read', arguments: { file_path: '/b' } },
						{ type: 'toolCall', id: 'tool-3', name: 'Write', arguments: { file_path: '/c' } },
					],
				},
			} as unknown as SessionEntry,
		] );
		expect( items.map( ( item ) => item.kind ) ).toEqual( [
			'work-phase',
			'assistant-text',
			'work-phase',
		] );
	} );

	it( 'includes chat artifacts inside the work phase', () => {
		const items = entriesToRenderItems( [
			assistantToolCallEntry( 'take_screenshot', { url: 'http://localhost:8888/' } ),
			{
				type: 'custom',
				id: 'artifact-1',
				parentId: null,
				timestamp: '2026-06-05T12:00:02.000Z',
				customType: 'studio.chat_artifact',
				data: {
					version: 1,
					id: 'artifact-1',
					widgets: [
						{
							type: 'media',
							widgetProps: {
								mediaKind: 'image',
								url: 'https://example.com/shot.png',
								alt: 'Screenshot',
							},
						},
					],
				},
			} as unknown as SessionEntry,
		] );
		expect( items ).toHaveLength( 1 );
		expect( items[ 0 ]?.kind ).toBe( 'work-phase' );
		if ( items[ 0 ]?.kind === 'work-phase' ) {
			expect( items[ 0 ].steps.map( ( step ) => step.kind ) ).toEqual( [
				'tool-use',
				'chat-artifact',
			] );
		}
	} );

	it( 'renders one expandable summary for the whole work phase', () => {
		const data = loadedSession( [
			assistantMultiToolCallEntry( [
				{ id: 'tool-1', name: 'Bash', arguments: { command: 'npm test' } },
				{ id: 'tool-2', name: 'Bash', arguments: { command: 'npm run lint' } },
			] ),
			toolResultEntryForId( 'tool-1', 'ok' ),
			toolResultEntryForId( 'tool-2', 'ok' ),
		] );

		renderConversation( data );

		expect( screen.getByRole( 'button', { name: 'Ran 2 commands' } ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Run terminal command' } )
		).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Ran 2 commands' } ) );

		expect( screen.getAllByRole( 'button', { name: 'Run terminal command' } ) ).toHaveLength( 2 );
	} );

	it( 'does not emit a work phase for text-only replies', () => {
		const items = entriesToRenderItems( [
			{
				type: 'message',
				id: 'assistant-text-only',
				parentId: null,
				timestamp: '2026-06-05T12:00:00.000Z',
				message: {
					role: 'assistant',
					content: [ { type: 'text', text: 'Just a reply.' } ],
				},
			} as unknown as SessionEntry,
		] );
		expect( items.map( ( item ) => item.kind ) ).toEqual( [ 'assistant-text' ] );
	} );
} );

function assistantMultiToolCallEntry(
	tools: Array< { id: string; name: string; arguments: Record< string, unknown > } >
): SessionEntry {
	return {
		type: 'message',
		id: 'assistant-multi-tool',
		parentId: null,
		timestamp: '2026-06-05T12:00:00.000Z',
		message: {
			role: 'assistant',
			content: tools.map( ( tool ) => ( {
				type: 'toolCall',
				id: tool.id,
				name: tool.name,
				arguments: tool.arguments,
			} ) ),
		},
	} as unknown as SessionEntry;
}

function toolResultEntryForId( toolCallId: string, text: string ): SessionEntry {
	return {
		type: 'message',
		id: `tool-result-${ toolCallId }`,
		parentId: null,
		timestamp: '2026-06-05T12:00:01.000Z',
		message: {
			role: 'toolResult',
			toolCallId,
			content: [ { type: 'text', text } ],
		},
	} as unknown as SessionEntry;
}
