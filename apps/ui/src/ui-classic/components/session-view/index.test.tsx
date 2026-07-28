import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '@/data/queries/use-sessions';
import { SessionView } from './index';

const { navigateMock } = vi.hoisted( () => ( { navigateMock: vi.fn() } ) );

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigateMock,
} ) );

vi.mock( '@/data/queries/use-sessions', () => ( {
	useSession: vi.fn(),
	useSessionEffectiveEnvironment: () => 'local',
	useSessions: () => ( { data: [] } ),
	useCreateSession: () => ( { mutateAsync: vi.fn(), isPending: false } ),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: () => ( { data: [] } ),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: () => ( { data: undefined } ),
} ) );

vi.mock( '@/data/queries/use-agent-run', () => ( {
	useAgentRun: () => ( {
		isRunning: false,
		hasActiveRun: false,
		isInterrupting: false,
		startedAt: undefined,
		error: null,
		pendingQuestions: [],
		pendingPermissions: [],
		answeredPermissions: new Map(),
		pendingAnswers: [],
		queuedPrompts: [],
		sendMessage: vi.fn(),
		interrupt: vi.fn(),
		answerQuestion: vi.fn(),
		answerPermission: vi.fn(),
		removeQueuedPrompt: vi.fn(),
	} ),
} ) );

vi.mock( '@/hooks/use-session-commands', () => ( { useSessionCommands: vi.fn() } ) );

vi.mock( '@/hooks/use-session-ui', () => ( {
	SessionUIProvider: ( { children }: { children: React.ReactNode } ) => children,
	useSessionPreviewAnnotations: vi.fn(),
	useSessionPreviewClips: vi.fn(),
	useSessionPreviewClipMarkersPublisher: () => vi.fn(),
	useSessionPreviewConsoleEntries: () => [],
} ) );

vi.mock( '@/hooks/use-traffic-light-space', () => ( {
	useTrafficLightSpace: () => ( { start: false, end: false } ),
} ) );

vi.mock( './composer', () => ( {
	Composer: () => <div />,
	ComposerSkeleton: () => <div />,
} ) );

vi.mock( './conversation', () => ( {
	Conversation: () => <div />,
} ) );

const useSessionMock = vi.mocked( useSession, { partial: true } );

describe( 'SessionView', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'redirects to the root instead of flashing the error when the session is gone', async () => {
		useSessionMock.mockReturnValue( {
			data: undefined,
			isLoading: false,
			error: new Error( 'not found' ),
		} );

		render( <SessionView sessionId="deleted-session" /> );

		await waitFor( () => expect( navigateMock ).toHaveBeenCalledWith( { to: '/' } ) );
		expect( screen.queryByText( 'Session not found' ) ).not.toBeInTheDocument();
	} );

	it( 'does not redirect while the session is still loading', () => {
		useSessionMock.mockReturnValue( { data: undefined, isLoading: true, error: null } );

		render( <SessionView sessionId="loading-session" /> );

		expect( navigateMock ).not.toHaveBeenCalled();
	} );
} );
