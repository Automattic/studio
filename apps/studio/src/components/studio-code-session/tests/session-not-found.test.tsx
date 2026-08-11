// Run tests: npm test -- apps/studio/src/components/studio-code-session/tests/session-not-found.test.tsx
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
	},
} ) );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => mockIpc,
} ) );

vi.mock( 'src/hooks/use-auth', () => ( {
	useAuth: () => ( { isAuthenticated: true, authenticate: vi.fn() } ),
} ) );

vi.mock( 'src/stores/wpcom-api', () => ( {
	useGetStudioAssistantQuota: () => ( {
		data: undefined,
		isLoading: false,
		isFetching: false,
		refetch: vi.fn(),
	} ),
} ) );

vi.mock( '../use-agent-run', () => ( {
	AgentRunProvider: ( { children }: { children: React.ReactNode } ) => children,
	useAgentRun: () => ( {
		isRunning: false,
		hasActiveRun: false,
		isInterrupting: false,
		startedAt: undefined,
		error: null,
		usageCapReached: false,
		pendingQuestions: [],
		pendingPermissions: [],
		answeredPermissions: new Map(),
		pendingAnswers: new Map(),
		answeredQuestions: new Map(),
		queuedPrompts: [],
		sendMessage: vi.fn(),
		interrupt: vi.fn(),
		answerQuestion: vi.fn(),
		answerPermission: vi.fn(),
		removeQueuedPrompt: vi.fn(),
	} ),
} ) );

vi.mock( '../composer', () => ( {
	Composer: () => <div data-testid="composer" />,
	ComposerSkeleton: () => <div data-testid="composer-skeleton" />,
	clearSessionDraft: vi.fn(),
} ) );

vi.mock( '../conversation', () => ( {
	Conversation: () => <div data-testid="conversation" />,
	wasLastTurnInterrupted: () => false,
} ) );

vi.mock( '../queued-prompts', () => ( {
	QueuedPrompts: () => null,
} ) );

vi.mock( '../use-site-creation-switch', () => ( {
	useSiteCreationSwitch: () => ( { pending: null, openNewSite: vi.fn(), stayHere: vi.fn() } ),
} ) );

vi.mock( '../site-created-dialog', () => ( {
	SiteCreatedDialog: () => null,
} ) );

vi.mock( '../use-example-prompts', () => ( {
	useExamplePrompts: () => [],
} ) );

vi.mock( '../lock-unlock', () => ( {
	unlock: () => ( {
		ThemeProvider: ( { children }: { children: React.ReactNode } ) => children,
	} ),
} ) );

const selectedSite = { id: 'site-1', name: 'Test Site', path: '/tmp/site-1' } as SiteDetails;

beforeEach( () => {
	vi.clearAllMocks();
	localStorage.clear();
	queryClient.clear();
} );

describe( 'StudioCodeSession session-not-found recovery', () => {
	it( 'recovers from a stored session that no longer exists on disk', async () => {
		localStorage.setItem( STORAGE_KEY, JSON.stringify( { 'site-1': 'missing-session' } ) );
		mockIpc.loadAiSession.mockImplementation( async ( sessionId: string ) => {
			if ( sessionId === 'missing-session' ) {
				throw new Error( `Code session not found: ${ sessionId }` );
			}
			return { summary: { id: sessionId }, entries: [] };
		} );
		mockIpc.createAiSession.mockResolvedValue( { id: 'fresh-session' } );

		render( <StudioCodeSession selectedSite={ selectedSite } /> );

		await screen.findByText( 'Session not found' );

		await userEvent.click( screen.getByRole( 'button', { name: /new conversation/i } ) );

		await waitFor( () => {
			expect( mockIpc.createAiSession ).toHaveBeenCalledWith( 'site-1' );
			expect( screen.getByTestId( 'composer' ) ).toBeInTheDocument();
		} );
		expect( JSON.parse( localStorage.getItem( STORAGE_KEY ) ?? '{}' ) ).toEqual( {
			'site-1': 'fresh-session',
		} );
	} );
} );
