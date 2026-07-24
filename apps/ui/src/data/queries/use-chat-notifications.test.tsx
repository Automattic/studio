import { DEFAULT_ACTIVITY_SOUND_PREFERENCES } from '@studio/common/lib/activity-sounds';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { setVisibleSessionId } from '@/lib/visible-session';
import { playConfiguredActivitySound } from './use-activity-sounds';
import { AgentRunProvider, useAgentRun } from './use-agent-run';
import { useChatNotifications } from './use-chat-notifications';
import { useSessions } from './use-sessions';
import { useUserPreferences } from './use-user-preferences';
import type { AgentRunEvent, AiSessionSummary, Connector, UserPreferences } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return {
		...actual,
		useConnector: vi.fn(),
	};
} );

vi.mock( './use-activity-sounds', () => ( {
	playConfiguredActivitySound: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );

const PREFERENCES: UserPreferences = {
	editor: null,
	terminal: null,
	colorScheme: 'system',
	locale: undefined,
	analyticsEnabled: true,
	defaultSiteDirectory: '',
	studioCliInstalled: false,
	studioCliExternallyManaged: false,
	agenticFeaturesEnabled: true,
	chatNotificationsEnabled: true,
	activitySoundPreferences: DEFAULT_ACTIVITY_SOUND_PREFERENCES,
	quitSitesBehavior: 'ask',
	agentResponseLength: 'normal',
	toolPermissions: {},
	defaultAiModel: 'claude-sonnet-5',
};

function createQueryClient() {
	return new QueryClient( {
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	} );
}

function renderWithNotifications() {
	function Harness() {
		useChatNotifications();
		const run = useAgentRun( 'session-1' );
		const { data: preferences } = useUserPreferences();
		const { data: sessions } = useSessions();

		return (
			<>
				<span data-testid="data">{ preferences && sessions ? 'loaded' : 'loading' }</span>
				<button onClick={ () => void run.sendMessage( 'Queued follow-up' ) }>Queue</button>
			</>
		);
	}

	function Wrapper( { children }: { children: ReactNode } ) {
		return (
			<QueryClientProvider client={ createQueryClient() }>
				<AgentRunProvider>{ children }</AgentRunProvider>
			</QueryClientProvider>
		);
	}

	return render( <Harness />, { wrapper: Wrapper } );
}

describe( 'useChatNotifications', () => {
	let agentListener: ( event: AgentRunEvent ) => void;
	let connector: Pick<
		Connector,
		| 'continueSession'
		| 'getActiveAgentRuns'
		| 'onAgentEvent'
		| 'getUserPreferences'
		| 'getSessions'
		| 'showChatNotification'
	>;

	beforeEach( () => {
		connector = {
			continueSession: vi.fn().mockResolvedValue( { runId: 'run-next' } ),
			getActiveAgentRuns: vi.fn().mockResolvedValue( [] ),
			onAgentEvent: vi.fn( ( listener ) => {
				agentListener = listener;
				return vi.fn();
			} ),
			getUserPreferences: vi.fn().mockResolvedValue( PREFERENCES ),
			getSessions: vi
				.fn()
				.mockResolvedValue( [ { id: 'session-1', ownerSiteName: 'My Site' } as AiSessionSummary ] ),
			showChatNotification: vi.fn().mockResolvedValue( undefined ),
		};
		useConnectorMock.mockReturnValue( connector as Connector );
	} );

	afterEach( () => {
		setVisibleSessionId( null );
		vi.clearAllMocks();
	} );

	async function setup() {
		renderWithNotifications();
		await waitFor( () => expect( connector.onAgentEvent ).toHaveBeenCalled() );
		await waitFor( () => expect( screen.getByTestId( 'data' ) ).toHaveTextContent( 'loaded' ) );
	}

	function startRun( runId = 'run-1' ) {
		agentListener( {
			sessionId: 'session-1',
			runId,
			event: { type: 'run.started', timestamp: '2026-07-02T12:00:00.000Z' },
		} );
	}

	function completeTurn( runId = 'run-1' ) {
		agentListener( {
			sessionId: 'session-1',
			runId,
			event: {
				type: 'turn.completed',
				timestamp: '2026-07-02T12:00:01.000Z',
				sessionId: 'session-1',
				status: 'success',
			},
		} );
	}

	function exitRun( runId = 'run-1' ) {
		agentListener( {
			sessionId: 'session-1',
			runId,
			event: {
				type: 'run.exited',
				timestamp: '2026-07-02T12:00:02.000Z',
				status: 'success',
				code: 0,
			},
		} );
	}

	it( 'notifies once when the turn completes, and stays silent on run exit', async () => {
		await setup();

		act( () => {
			startRun();
			completeTurn();
		} );

		expect( connector.showChatNotification ).toHaveBeenCalledTimes( 1 );
		expect( connector.showChatNotification ).toHaveBeenCalledWith(
			expect.objectContaining( {
				sessionId: 'session-1',
				kind: 'response-complete',
				title: 'My Site',
			} )
		);
		expect( playConfiguredActivitySound ).toHaveBeenCalledWith(
			DEFAULT_ACTIVITY_SOUND_PREFERENCES,
			'agent-complete'
		);

		act( () => {
			exitRun();
		} );

		expect( connector.showChatNotification ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'notifies when the agent asks questions', async () => {
		await setup();

		act( () => {
			startRun();
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-1',
				event: {
					type: 'question.asked',
					timestamp: '2026-07-02T12:00:01.000Z',
					questions: [ { question: 'Pick one', options: [] } ],
				},
			} );
		} );

		expect( connector.showChatNotification ).toHaveBeenCalledTimes( 1 );
		expect( connector.showChatNotification ).toHaveBeenCalledWith(
			expect.objectContaining( { sessionId: 'session-1', kind: 'pending-question' } )
		);
		expect( playConfiguredActivitySound ).toHaveBeenCalledWith(
			DEFAULT_ACTIVITY_SOUND_PREFERENCES,
			'attention-required'
		);
	} );

	it( 'stays silent when the user interrupts the run', async () => {
		await setup();

		act( () => {
			startRun();
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-1',
				event: { type: 'run.interrupting', timestamp: '2026-07-02T12:00:01.000Z' },
			} );
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-1',
				event: { type: 'run.interrupted', timestamp: '2026-07-02T12:00:02.000Z' },
			} );
		} );

		expect( connector.showChatNotification ).not.toHaveBeenCalled();
		expect( playConfiguredActivitySound ).not.toHaveBeenCalled();
	} );

	it( 'suppresses the completion notification when a queued follow-up will auto-dispatch', async () => {
		await setup();

		act( () => {
			startRun();
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );
		act( () => {
			completeTurn();
		} );

		expect( connector.showChatNotification ).not.toHaveBeenCalled();
		expect( playConfiguredActivitySound ).not.toHaveBeenCalled();
	} );

	it( 'stays silent when the user is already viewing the session in a focused window', async () => {
		vi.spyOn( document, 'hasFocus' ).mockReturnValue( true );
		setVisibleSessionId( 'session-1' );

		await setup();

		act( () => {
			startRun();
			completeTurn();
		} );

		expect( connector.showChatNotification ).not.toHaveBeenCalled();
	} );

	it( 'notifies when the window is focused but a different session is on screen', async () => {
		vi.spyOn( document, 'hasFocus' ).mockReturnValue( true );
		setVisibleSessionId( 'session-2' );

		await setup();

		act( () => {
			startRun();
			completeTurn();
		} );

		expect( connector.showChatNotification ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'notifies for the visible session when the window is not focused', async () => {
		vi.spyOn( document, 'hasFocus' ).mockReturnValue( false );
		setVisibleSessionId( 'session-1' );

		await setup();

		act( () => {
			startRun();
			completeTurn();
		} );

		expect( connector.showChatNotification ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'stays silent when the preference is turned off', async () => {
		connector.getUserPreferences = vi
			.fn()
			.mockResolvedValue( { ...PREFERENCES, chatNotificationsEnabled: false } );

		await setup();

		act( () => {
			startRun();
			completeTurn();
		} );

		expect( connector.showChatNotification ).not.toHaveBeenCalled();
	} );
} );
