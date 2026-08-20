import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useSession } from '@/data/queries/use-sessions';
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

vi.mock( '@/data/queries/use-assistant-quota', () => ( {
	useStudioAssistantQuota: vi.fn(),
} ) );

vi.mock( '@/data/core', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	useConnector: () => ( { openExternalUrl: vi.fn() } ),
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
	Composer: () => <div data-testid="composer" />,
	ComposerSkeleton: () => <div data-testid="composer-skeleton" />,
} ) );

vi.mock( './conversation', () => ( {
	Conversation: () => <div />,
} ) );

const useSessionMock = vi.mocked( useSession, { partial: true } );
const useStudioAssistantQuotaMock = vi.mocked( useStudioAssistantQuota, { partial: true } );

function makeQuota( overrides: Partial< { hasPaymentMethod: boolean; emailVerified: boolean } > ) {
	return {
		costUsage: 0,
		costCap: 500000,
		costResetDate: '2026-09-01T00:00:00+00:00',
		emailVerified: true,
		hasPaymentMethod: true,
		studioCodeAiHasAccess: true,
		studioCodeAiAccess: 'granted',
		allowanceRemaining: undefined,
		purchasedRemaining: undefined,
		...overrides,
	};
}

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
		// Entitled account by default; individual tests override.
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: makeQuota( {} ),
			isLoading: false,
			isFetching: false,
			refetch: vi.fn(),
		} );
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

	it( 'gates the chat behind the payment requirement when no payment method is saved', () => {
		useSessionMock.mockReturnValue( {
			data: makeLoadedSession(),
			isLoading: false,
			error: null,
		} );
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: makeQuota( { hasPaymentMethod: false } ),
			isFetching: false,
			refetch: vi.fn(),
		} );

		render( <SessionView sessionId="session-1" /> );

		expect( screen.getByText( 'Studio Code Beta' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Add payment method' } ) ).toBeInTheDocument();
	} );

	it( 'keeps the composer hidden while the entitlement check is loading', () => {
		useSessionMock.mockReturnValue( {
			data: makeLoadedSession(),
			isLoading: false,
			error: null,
		} );
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: undefined,
			isLoading: true,
			isFetching: true,
			refetch: vi.fn(),
		} );

		render( <SessionView sessionId="session-1" /> );

		expect( screen.queryByTestId( 'composer' ) ).not.toBeInTheDocument();
		expect( screen.getByTestId( 'composer-skeleton' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Studio Code Beta' ) ).not.toBeInTheDocument();
	} );

	it( 'fades the composer in only after the entitlement check resolves', () => {
		useSessionMock.mockReturnValue( {
			data: makeLoadedSession(),
			isLoading: false,
			error: null,
		} );
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: undefined,
			isLoading: true,
			isFetching: true,
			refetch: vi.fn(),
		} );

		const { container, rerender } = render( <SessionView sessionId="session-1" /> );
		expect( container.querySelector( '[class*="fadeInQuick"]' ) ).toBeNull();

		useStudioAssistantQuotaMock.mockReturnValue( {
			data: makeQuota( {} ),
			isLoading: false,
			isFetching: false,
			refetch: vi.fn(),
		} );
		rerender( <SessionView sessionId="session-1" /> );

		expect( container.querySelector( '[class*="fadeInQuick"]' ) ).not.toBeNull();
	} );

	it( 'does not fade the composer on a plain session load', () => {
		useSessionMock.mockReturnValue( {
			data: makeLoadedSession(),
			isLoading: false,
			error: null,
		} );

		const { container } = render( <SessionView sessionId="session-1" /> );

		expect( screen.getByTestId( 'composer' ) ).toBeInTheDocument();
		expect( container.querySelector( '[class*="fadeInQuick"]' ) ).toBeNull();
	} );

	it( 'fades the chat surface behind the composer', () => {
		useSessionMock.mockReturnValue( {
			data: makeLoadedSession(),
			isLoading: false,
			error: null,
		} );

		const { container } = render( <SessionView sessionId="session-1" /> );

		expect( container.querySelectorAll( '[class*="fadeToSurface"]' ) ).toHaveLength( 2 );
	} );

	it( 'ignores an unverified email when a payment method exists', () => {
		useSessionMock.mockReturnValue( {
			data: makeLoadedSession(),
			isLoading: false,
			error: null,
		} );
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: makeQuota( { emailVerified: false } ),
			isFetching: false,
			refetch: vi.fn(),
		} );

		render( <SessionView sessionId="session-1" /> );

		expect( screen.queryByText( 'Studio Code Beta' ) ).not.toBeInTheDocument();
	} );

	it( 'fails open when the quota is unavailable', () => {
		useSessionMock.mockReturnValue( {
			data: makeLoadedSession(),
			isLoading: false,
			error: null,
		} );
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: undefined,
			isFetching: false,
			refetch: vi.fn(),
		} );

		render( <SessionView sessionId="session-1" /> );

		expect( screen.queryByText( 'Studio Code Beta' ) ).not.toBeInTheDocument();
	} );

	it( 'publishes the composer height for the collapsed-sidebar toast shelf', () => {
		useSessionMock.mockReturnValue( {
			data: makeLoadedSession(),
			isLoading: false,
			error: null,
		} );

		const { container, unmount } = render( <SessionView sessionId="session-1" /> );

		const composer = container.querySelector( '[class*="composerOuter"]' ) as HTMLDivElement;
		expect( composer ).not.toBeNull();
		Object.defineProperty( composer, 'offsetHeight', { value: 120, configurable: true } );
		fireEvent( window, new Event( 'resize' ) );

		expect( document.documentElement.style.getPropertyValue( '--app-main-composer-height' ) ).toBe(
			'120px'
		);

		unmount();

		expect( document.documentElement.style.getPropertyValue( '--app-main-composer-height' ) ).toBe(
			''
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
