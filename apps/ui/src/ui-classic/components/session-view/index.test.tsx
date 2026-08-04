import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '@/data/queries/use-sessions';
import { setUsageExplorationScenario } from '@/data/usage-exploration';
import { isScrolledAwayFromLatest, SessionView } from './index';
import type { LoadedAiSession } from '@/data/core';

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

vi.mock( '@/data/queries/use-agent-run', () => ( {
	useAgentRun: () => ( {
		isRunning: false,
		hasActiveRun: false,
		isInterrupting: false,
		startedAt: undefined,
		error: null,
		pendingQuestions: [],
		pendingAnswers: [],
		queuedPrompts: [],
		sendMessage: vi.fn(),
		interrupt: vi.fn(),
		answerQuestion: vi.fn(),
		removeQueuedPrompt: vi.fn(),
	} ),
} ) );

vi.mock( '@/hooks/use-session-commands', () => ( { useSessionCommands: vi.fn() } ) );

vi.mock( '@/hooks/use-session-ui', () => ( {
	SessionUIProvider: ( { children }: { children: React.ReactNode } ) => children,
	useSessionPreviewAnnotations: vi.fn(),
} ) );

vi.mock( '@/hooks/use-traffic-light-space', () => ( {
	useTrafficLightSpace: () => ( { start: false, end: false } ),
} ) );

vi.mock( './composer', () => ( {
	Composer: ( { usageNotice }: { usageNotice?: React.ReactNode } ) => (
		<div data-session-composer>{ usageNotice }</div>
	),
	ComposerSkeleton: () => <div />,
} ) );

vi.mock( './conversation', () => ( {
	Conversation: () => <div />,
} ) );

vi.mock( '@/components/purchase-credits-dialog', () => ( {
	PurchaseCreditsDialog: () => null,
} ) );

const useSessionMock = vi.mocked( useSession, { partial: true } );

const SCROLL_TO_LATEST_LABEL = 'Scroll to latest message';

function makeLoadedSession(): LoadedAiSession {
	return {
		summary: { id: 'session-1' },
		entries: [],
	} as unknown as LoadedAiSession;
}

function setScrollMetrics(
	node: HTMLElement,
	metrics: { scrollTop: number; scrollHeight: number; clientHeight: number }
) {
	for ( const [ key, value ] of Object.entries( metrics ) ) {
		Object.defineProperty( node, key, { value, writable: true, configurable: true } );
	}
}

describe( 'SessionView', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		setUsageExplorationScenario( 'warning' );
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

	it( 'replaces the composer when the account is out of credits', () => {
		setUsageExplorationScenario( 'exhausted' );
		useSessionMock.mockReturnValue( {
			data: makeLoadedSession(),
			isLoading: false,
			error: null,
		} );

		render( <SessionView sessionId="session-1" /> );

		expect( screen.getByRole( 'alert' ) ).toHaveTextContent( 'Monthly credits used' );
		expect( screen.getByRole( 'alert' ) ).toHaveTextContent(
			"You've used up your free $50 for the month."
		);
		expect( screen.getByRole( 'button', { name: 'Add credits' } ) ).toBeInTheDocument();
	} );

	it( 'explains when purchased credits are exhausted', () => {
		setUsageExplorationScenario( 'extra-exhausted' );
		useSessionMock.mockReturnValue( {
			data: makeLoadedSession(),
			isLoading: false,
			error: null,
		} );

		render( <SessionView sessionId="session-1" /> );

		expect( screen.getByRole( 'alert' ) ).toHaveTextContent( 'Extra AI credits used' );
		expect( screen.getByRole( 'alert' ) ).toHaveTextContent(
			"You've used all of your extra AI credits."
		);
	} );

	it( 'shows a persistent composer strip at 90% usage', () => {
		setUsageExplorationScenario( 'critical' );
		useSessionMock.mockReturnValue( {
			data: makeLoadedSession(),
			isLoading: false,
			error: null,
		} );

		render( <SessionView sessionId="session-1" /> );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'At 90% usage' );
		expect( screen.getByRole( 'status' ).closest( '[data-session-composer]' ) ).not.toBeNull();
	} );

	it( 'does not show the composer strip at 80% usage', () => {
		setUsageExplorationScenario( 'warning' );
		useSessionMock.mockReturnValue( {
			data: makeLoadedSession(),
			isLoading: false,
			error: null,
		} );

		render( <SessionView sessionId="session-1" /> );

		expect( screen.queryByRole( 'status' ) ).not.toBeInTheDocument();
	} );

	it( 'shows the composer strip while extra credits reach 90% usage', () => {
		setUsageExplorationScenario( 'extra-critical' );
		useSessionMock.mockReturnValue( {
			data: makeLoadedSession(),
			isLoading: false,
			error: null,
		} );

		render( <SessionView sessionId="session-1" /> );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'At 90% extra credit usage' );
	} );

	it( 'shows the scroll-to-latest button only while scrolled away and scrolls down on click', async () => {
		useSessionMock.mockReturnValue( {
			data: makeLoadedSession(),
			isLoading: false,
			error: null,
		} );

		const { container } = render( <SessionView sessionId="session-1" /> );

		const scroller = container.querySelector( '[class*="classicScroll"]' ) as HTMLDivElement;
		expect( scroller ).not.toBeNull();
		expect(
			screen.queryByRole( 'button', { name: SCROLL_TO_LATEST_LABEL } )
		).not.toBeInTheDocument();

		setScrollMetrics( scroller, { scrollTop: 100, scrollHeight: 1000, clientHeight: 400 } );
		fireEvent.scroll( scroller );

		const button = await screen.findByRole( 'button', { name: SCROLL_TO_LATEST_LABEL } );

		scroller.scrollTo = vi.fn();
		fireEvent.click( button );
		expect( scroller.scrollTo ).toHaveBeenCalledWith( { top: 1000, behavior: 'smooth' } );

		setScrollMetrics( scroller, { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 } );
		fireEvent.scroll( scroller );
		await waitFor( () =>
			expect(
				screen.queryByRole( 'button', { name: SCROLL_TO_LATEST_LABEL } )
			).not.toBeInTheDocument()
		);
	} );
} );

describe( 'isScrolledAwayFromLatest', () => {
	it( 'is false at the very bottom', () => {
		expect(
			isScrolledAwayFromLatest( { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 } )
		).toBe( false );
	} );

	it( 'is false within the near-bottom threshold', () => {
		expect(
			isScrolledAwayFromLatest( { scrollTop: 560, scrollHeight: 1000, clientHeight: 400 } )
		).toBe( false );
	} );

	it( 'is true when scrolled beyond the threshold', () => {
		expect(
			isScrolledAwayFromLatest( { scrollTop: 500, scrollHeight: 1000, clientHeight: 400 } )
		).toBe( true );
	} );

	it( 'is false when the content fits without scrolling', () => {
		expect(
			isScrolledAwayFromLatest( { scrollTop: 0, scrollHeight: 400, clientHeight: 400 } )
		).toBe( false );
	} );
} );
