// Run tests: npm test -- apps/studio/src/components/studio-code-session/tests/free-form-arming.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioCodeSession } from '..';
import { queryClient } from '../query-client';

const STORAGE_KEY = 'studio_code_session_ids';

const { mockIpc } = vi.hoisted( () => ( {
	mockIpc: {
		loadAiSession: vi.fn(),
		createAiSession: vi.fn(),
		markAiMessageEdited: vi.fn(),
		readLocalMediaFile: vi.fn(),
		copyText: vi.fn(),
	},
} ) );

// A stateful stand-in for the real reducer: answering one question of a
// multi-question batch records the answer but leaves the batch pending, which
// is the state the arming bug lived in.
const { agentRun } = vi.hoisted( () => ( {
	agentRun: {
		pendingAnswers: {} as Record< string, string >,
		answerQuestion: vi.fn(),
	},
} ) );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => mockIpc,
} ) );

vi.mock( 'src/hooks/use-auth', () => ( {
	useAuth: () => ( { isAuthenticated: true, authenticate: vi.fn() } ),
} ) );

vi.mock( 'src/hooks/use-is-out-of-ai-credits', () => ( {
	useIsOutOfAiCredits: () => false,
} ) );

// Partial: the real `wpcomApi` slice is still needed by the store wiring this
// component tree pulls in.
vi.mock( 'src/stores/wpcom-api', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('src/stores/wpcom-api') >() ),
	useGetStudioAssistantQuota: () => ( {
		data: undefined,
		isLoading: false,
		isFetching: false,
		refetch: vi.fn(),
	} ),
} ) );

const QUESTIONS = [
	{ question: 'Q1', options: [ { label: 'A', description: '' } ] },
	{ question: 'Q2', options: [ { label: 'B', description: '' } ] },
];

vi.mock( '../use-agent-run', async () => {
	const { useState } = await import( 'react' );
	return {
		AgentRunProvider: ( { children }: { children: React.ReactNode } ) => children,
		useAgentRun: () => {
			const [ pendingAnswers, setPendingAnswers ] = useState< Record< string, string > >( {} );
			agentRun.pendingAnswers = pendingAnswers;
			return {
				isRunning: true,
				hasActiveRun: true,
				isInterrupting: false,
				startedAt: Date.now(),
				error: null,
				usageCapReached: false,
				pendingQuestions: QUESTIONS,
				pendingAnswers,
				answeredQuestions: {},
				queuedPrompts: [],
				sendMessage: vi.fn(),
				interrupt: vi.fn(),
				// Mirrors the real reducer's `question_answered`: the batch stays
				// pending until every question has an answer.
				answerQuestion: ( question: string, answer: string ) => {
					agentRun.answerQuestion( question, answer );
					setPendingAnswers( ( answers ) => ( { ...answers, [ question ]: answer } ) );
				},
				removeQueuedPrompt: vi.fn(),
			};
		},
	};
} );

vi.mock( '../composer', () => ( {
	Composer: ( { freeFormActive }: { freeFormActive?: boolean } ) => (
		<div data-testid="composer" data-free-form-active={ freeFormActive ? 'true' : 'false' } />
	),
	ComposerSkeleton: () => <div data-testid="composer-skeleton" />,
	clearSessionDraft: vi.fn(),
} ) );

vi.mock( '../queued-prompts', () => ( { QueuedPrompts: () => null } ) );
vi.mock( '../use-site-creation-switch', () => ( {
	useSiteCreationSwitch: () => ( { pending: null, openNewSite: vi.fn(), stayHere: vi.fn() } ),
} ) );
vi.mock( '../site-created-dialog', () => ( { SiteCreatedDialog: () => null } ) );
vi.mock( '../use-example-prompts', () => ( { useExamplePrompts: () => [] } ) );
vi.mock( '../lock-unlock', () => ( {
	unlock: () => ( {
		ThemeProvider: ( { children }: { children: React.ReactNode } ) => children,
	} ),
} ) );

const selectedSite = { id: 'site-1', name: 'Test Site', path: '/tmp/site-1' } as SiteDetails;

function questionEntry( id: string, question: string, optionLabel: string ) {
	return {
		type: 'custom',
		id,
		parentId: null,
		timestamp: '2026-08-28T00:00:00.000Z',
		customType: 'studio.agent_question',
		data: { question, options: [ { label: optionLabel, description: '' } ] },
	};
}

beforeEach( () => {
	vi.clearAllMocks();
	localStorage.clear();
	queryClient.clear();
	localStorage.setItem( STORAGE_KEY, JSON.stringify( { 'site-1': 'session-1' } ) );
	mockIpc.loadAiSession.mockResolvedValue( {
		summary: { id: 'session-1' },
		entries: [ questionEntry( 'q1', 'Q1', 'A' ), questionEntry( 'q2', 'Q2', 'B' ) ],
	} );
} );

describe( 'free-form arming', () => {
	it( 'disarms "Something else" when the user picks a listed option instead', async () => {
		render( <StudioCodeSession selectedSite={ selectedSite } /> );

		const freeFormButtons = await screen.findAllByRole( 'button', { name: 'Something else' } );
		const q1FreeForm = freeFormButtons[ 0 ];

		await userEvent.click( q1FreeForm );
		expect( q1FreeForm ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( screen.getByTestId( 'composer' ) ).toHaveAttribute( 'data-free-form-active', 'true' );

		await userEvent.click( screen.getByRole( 'button', { name: 'A' } ) );

		// The batch is still pending (Q2 is unanswered), so nothing else clears
		// the arming.
		await waitFor( () =>
			expect( screen.getAllByRole( 'button', { name: 'Something else' } )[ 0 ] ).toHaveAttribute(
				'aria-pressed',
				'false'
			)
		);
		expect( screen.getByTestId( 'composer' ) ).toHaveAttribute( 'data-free-form-active', 'false' );
		expect( agentRun.answerQuestion ).toHaveBeenCalledWith( 'Q1', 'A' );
	} );

	it( 'keeps a question armed when a different question is answered', async () => {
		render( <StudioCodeSession selectedSite={ selectedSite } /> );

		const freeFormButtons = await screen.findAllByRole( 'button', { name: 'Something else' } );
		await userEvent.click( freeFormButtons[ 0 ] );

		await userEvent.click( screen.getByRole( 'button', { name: 'B' } ) );

		expect( screen.getAllByRole( 'button', { name: 'Something else' } )[ 0 ] ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect( screen.getByTestId( 'composer' ) ).toHaveAttribute( 'data-free-form-active', 'true' );
	} );

	it( 'lets the user arm free-form after already picking an option', async () => {
		render( <StudioCodeSession selectedSite={ selectedSite } /> );

		await screen.findAllByRole( 'button', { name: 'Something else' } );
		await userEvent.click( screen.getByRole( 'button', { name: 'A' } ) );
		await userEvent.click( screen.getAllByRole( 'button', { name: 'Something else' } )[ 0 ] );

		expect( screen.getAllByRole( 'button', { name: 'Something else' } )[ 0 ] ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect( screen.getByTestId( 'composer' ) ).toHaveAttribute( 'data-free-form-active', 'true' );
	} );
} );
