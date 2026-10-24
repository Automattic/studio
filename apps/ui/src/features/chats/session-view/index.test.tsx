import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowControlsCornerContext } from '@/data/host/use-window-controls-inset';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useSession } from '@/data/queries/use-sessions';
import { pendingPromptSlot } from '@/features/chats/pending-prompt';
import { isScrolledAwayFromLatest } from './use-anchored-scroll';
import { SessionView } from './index';
import type { LoadedAiSession } from '@/data/core';

const { navigateMock, agentRunState, sitesState, aiSettingsState, accessState } = vi.hoisted(
	() => ( {
		navigateMock: vi.fn(),
		aiSettingsState: {
			data: undefined as undefined | Record< string, unknown >,
			isLoading: false,
			isError: false,
			refetch: vi.fn(),
		},
		accessState: {
			user: { id: 1 } as { id: number } | null,
			offline: false,
			openSettings: vi.fn(),
		},
		agentRunState: { hasActiveRun: false, sendMessage: vi.fn( async () => undefined ) },
		sitesState: {
			data: [] as Array< { id: string; path: string; name: string; running?: boolean } >,
		},
	} )
);

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigateMock,
} ) );

vi.mock( '@/data/queries/use-sessions', () => ( {
	useSession: vi.fn(),
	useSessionLiveSite: () => undefined,
	useSessions: () => ( { data: [] } ),
	useCreateSession: () => ( { mutateAsync: vi.fn(), isPending: false } ),
	useSetSessionEnvironment: () => ( { mutate: vi.fn() } ),
} ) );

vi.mock( '@/data/queries/use-connected-wpcom-sites', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	useConnectedWpcomSites: () => ( { data: [] } ),
} ) );

const siteMocks = vi.hoisted( () => ( {
	startSite: vi.fn(),
	preferences: { autoStartSiteOnChat: false },
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: () => sitesState,
	useIsSiteBusy: () => false,
	useIsSiteStarting: () => false,
	useIsSiteStopping: () => false,
	useStartSite: () => ( { mutate: siteMocks.startSite } ),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: () => ( { data: siteMocks.preferences } ),
} ) );

vi.mock( '@/features/sites/site-actions-menu', () => ( {
	SiteActionsMenu: ( { site }: { site: { name: string } } ) => <div>{ site.name }</div>,
} ) );

vi.mock( '@/features/sites/site-header-actions', () => ( {
	SiteHeaderSpace: () => <div data-testid="site-header-space" />,
	useSiteHeader: () => ( { host: 'chat' } ),
} ) );

vi.mock( '@/features/sites/stopped-site-preview', () => ( {
	SiteContextMenu: ( { children }: { children: React.ReactNode } ) => children,
	StoppedSitePreview: () => <div data-testid="stopped-site-preview" />,
} ) );

vi.mock( '@/data/queries/use-assistant-quota', () => ( {
	useStudioAssistantQuota: vi.fn(),
} ) );
vi.mock( '@/data/queries/use-ai-settings', () => ( {
	useAiSettings: () => aiSettingsState,
} ) );
vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: () => ( { data: accessState.user, isLoading: false } ),
} ) );
vi.mock( '@/lib/hooks/use-offline', () => ( { useOffline: () => accessState.offline } ) );
vi.mock( '@/features/settings/use-open-settings', () => ( {
	useOpenSettings: () => accessState.openSettings,
} ) );

const connectorMock = vi.hoisted( () => ( {
	openExternalUrl: vi.fn(),
	getAiSettings: vi.fn(),
	getAuthUser: vi.fn(),
	getStudioAssistantQuota: vi.fn(),
} ) );

vi.mock( '@/data/core', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	useConnector: () => connectorMock,
} ) );

vi.mock( '@/data/queries/use-agent-run', () => ( {
	useAgentRun: () => ( {
		isRunning: false,
		hasActiveRun: agentRunState.hasActiveRun,
		isInterrupting: false,
		startedAt: undefined,
		pendingQuestions: [],
		pendingAnswers: [],
		queuedPrompts: [],
		sendMessage: agentRunState.sendMessage,
		interrupt: vi.fn(),
		answerQuestion: vi.fn(),
		removeQueuedPrompt: vi.fn(),
	} ),
} ) );

vi.mock( './use-session-commands', () => ( { useSessionCommands: vi.fn() } ) );

vi.mock( '@/features/chats/use-session-ui', () => ( {
	SessionUIProvider: ( { children }: { children: React.ReactNode } ) => children,
	useOptionalSessionPreviewUI: () => null,
	useSessionPreviewUI: () => ( {
		pathsBySiteId: { 'site-1': '/wp-admin/' },
	} ),
	pathForSite: ( pathsBySiteId: Record< string, string >, siteId: string ) =>
		pathsBySiteId[ siteId ] ?? '/',
} ) );

vi.mock( '@/lib/hooks/use-window-controls-overlay', () => ( {
	useWindowControlsOverlay: () => ( { height: 32, controlsWidth: 138 } ),
} ) );

vi.mock( '@/data/host/use-traffic-light-space', () => ( {
	useTrafficLightSpace: () => ( { start: false, end: false } ),
} ) );

type ComposerMockProps = {
	onSend: ( prompt: string ) => Promise< void >;
	notice?: { message: string; action?: { label: string; onClick: () => void } };
};

const composerProps = vi.hoisted( () => ( {
	current: undefined as undefined | ComposerMockProps,
} ) );

vi.mock( './composer', () => ( {
	Composer: ( props: ComposerMockProps ) => {
		composerProps.current = props;
		useStudioAssistantQuota();
		return (
			<div data-testid="composer">
				{ props.notice?.message }
				{ props.notice?.action ? (
					<button type="button" onClick={ props.notice.action.onClick }>
						{ props.notice.action.label }
					</button>
				) : null }
			</div>
		);
	},
	ComposerSkeleton: () => <div data-testid="composer-skeleton" />,
} ) );

// Prompts render as scroll anchors laid out at their `top`.
vi.mock( './conversation', () => ( {
	Conversation: ( { data }: { data: { entries: Array< { id: string; top?: number } > } } ) => (
		<div data-testid="conversation">
			{ data.entries.map( ( entry ) => (
				<div key={ entry.id } data-scroll-anchor="" data-top={ entry.top } />
			) ) }
		</div>
	),
} ) );

vi.mock( '@/features/chats/chat-actions', () => ( {
	ChatContextMenu: ( { children }: { children: React.ReactNode } ) => children,
} ) );
vi.mock( './use-mark-chat-read', () => ( { useMarkChatRead: vi.fn() } ) );

const useSessionMock = vi.mocked( useSession, { partial: true } );
const useStudioAssistantQuotaMock = vi.mocked( useStudioAssistantQuota, { partial: true } );

function makeQuota(
	overrides: Partial< {
		hasPaymentMethod: boolean;
		emailVerified: boolean;
		allowanceRemaining: number;
		purchasedRemaining: number;
	} >
) {
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
		purchasedAtTopUp: undefined,
		...overrides,
	};
}

const jumpButton = () => screen.getByRole( 'button', { name: 'Jump to latest' } );

function makeLoadedSession(): LoadedAiSession {
	return {
		summary: { id: 'session-1' },
		entries: [],
	} as unknown as LoadedAiSession;
}

const OWNER_SITE = { id: 'demo-site', path: '/Users/example/Studio/demo-site', name: 'Demo' };

function makeOwnedSession(): LoadedAiSession {
	return {
		summary: { id: 'session-1', ownerSiteId: OWNER_SITE.id },
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

const PENDING_PROMPT = {
	sessionId: 'session-1',
	prompt: 'A bakery site',
	attachments: { images: [], files: [] },
};

describe( 'SessionView', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		agentRunState.hasActiveRun = false;
		sitesState.data = [];
		aiSettingsState.data = undefined;
		aiSettingsState.isError = false;
		accessState.user = { id: 1 };
		accessState.offline = false;
		siteMocks.preferences = { autoStartSiteOnChat: false };
		const pending = pendingPromptSlot.getSnapshot();
		if ( pending ) pendingPromptSlot.clear( pending );
		// Entitled account by default; individual tests override.
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: makeQuota( {} ),
			isLoading: false,
			isFetching: false,
			refetch: vi.fn(),
		} );
	} );

	it( 'moves the chat header clear of the Windows/Linux window controls', () => {
		sitesState.data = [
			{ id: 'site-1', name: 'Example Site', path: '/Users/example/Studio/example-site' },
		];
		useSessionMock.mockReturnValue( {
			data: {
				summary: { id: 'session-1', ownerSiteId: 'site-1', ownerSiteName: 'Example Site' },
				entries: [],
			} as unknown as LoadedAiSession,
			isLoading: false,
			error: null,
		} );

		const { rerender } = render(
			<WindowControlsCornerContext.Provider value>
				<SessionView sessionId="session-1" />
			</WindowControlsCornerContext.Provider>
		);
		const header = screen
			.getByText( 'Example Site' )
			.closest< HTMLElement >( '[data-site-header]' );
		expect( header?.style.paddingRight ).toBe( '146px' );

		rerender(
			<WindowControlsCornerContext.Provider value={ false }>
				<SessionView sessionId="session-1" />
			</WindowControlsCornerContext.Provider>
		);
		expect( header?.style.paddingRight ).toBe( '' );
	} );

	it( 'redirects to the root instead of flashing the error when the session is gone', async () => {
		useSessionMock.mockReturnValue( {
			data: undefined,
			isLoading: false,
			error: new Error( 'Code session not found: deleted-session' ),
		} );

		render( <SessionView sessionId="deleted-session" /> );

		await waitFor( () => expect( navigateMock ).toHaveBeenCalledWith( { to: '/' } ) );
	} );

	it( 'offers a retry instead of leaving when the chat fails to load', () => {
		const refetch = vi.fn();
		useSessionMock.mockReturnValue( {
			data: undefined,
			isLoading: false,
			error: new Error( 'EACCES' ),
			refetch,
		} );

		render( <SessionView sessionId="session-1" /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );

		expect( screen.getByText( 'This chat could not load.' ) ).toBeInTheDocument();
		expect( refetch ).toHaveBeenCalled();
		expect( navigateMock ).not.toHaveBeenCalled();
	} );

	it( 'does not redirect while the session is still loading', () => {
		useSessionMock.mockReturnValue( { data: undefined, isLoading: true, error: null } );

		render( <SessionView sessionId="loading-session" /> );

		expect( navigateMock ).not.toHaveBeenCalled();
	} );

	it( 'sends the prompt handed over for this session exactly once when the chat is ready', () => {
		pendingPromptSlot.set( PENDING_PROMPT );
		useSessionMock.mockReturnValue( { data: makeLoadedSession(), isLoading: false, error: null } );

		render(
			<StrictMode>
				<SessionView sessionId="session-1" />
			</StrictMode>
		);

		expect( agentRunState.sendMessage ).toHaveBeenCalledTimes( 1 );
		expect( agentRunState.sendMessage ).toHaveBeenCalledWith(
			'A bakery site',
			PENDING_PROMPT.attachments
		);
		expect( pendingPromptSlot.getSnapshot() ).toBeNull();
	} );

	it( 'holds the handed-over prompt while the chat is gated', () => {
		pendingPromptSlot.set( PENDING_PROMPT );
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: makeQuota( { hasPaymentMethod: false } ),
			isLoading: false,
			isFetching: false,
			refetch: vi.fn(),
		} );
		useSessionMock.mockReturnValue( { data: makeLoadedSession(), isLoading: false, error: null } );

		render( <SessionView sessionId="session-1" /> );

		expect( agentRunState.sendMessage ).not.toHaveBeenCalled();
		expect( pendingPromptSlot.getSnapshot() ).toBe( PENDING_PROMPT );
	} );

	it( 'shows the scroll-to-latest button only while scrolled away and scrolls down on click', async () => {
		useSessionMock.mockReturnValue( {
			data: makeLoadedSession(),
			isLoading: false,
			error: null,
		} );

		const { container } = render( <SessionView sessionId="session-1" /> );

		const scroller = container.querySelector( '[class*="_scroll_"]' ) as HTMLDivElement;
		expect( scroller ).not.toBeNull();
		expect( jumpButton() ).not.toHaveAttribute( 'data-visible' );

		setScrollMetrics( scroller, { scrollTop: 100, scrollHeight: 1000, clientHeight: 400 } );
		fireEvent.scroll( scroller );

		await waitFor( () => expect( jumpButton() ).toHaveAttribute( 'data-visible' ) );
		const button = jumpButton();

		scroller.scrollTo = vi.fn();
		fireEvent.click( button );
		expect( scroller.scrollTo ).toHaveBeenCalledWith( { top: 1000, behavior: 'smooth' } );
		expect( jumpButton() ).not.toHaveAttribute( 'data-visible' );

		// The smooth scroll on its way down keeps the button hidden.
		setScrollMetrics( scroller, { scrollTop: 300, scrollHeight: 1000, clientHeight: 400 } );
		fireEvent.scroll( scroller );
		expect( jumpButton() ).not.toHaveAttribute( 'data-visible' );
	} );

	it( 'wires the scroller when the session loads before the quota check resolves', async () => {
		// Cold start: the session is served from the persisted cache while the
		// (never persisted) quota query is still loading, so the conversation
		// scroller mounts in a later commit than the session data.
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
		const scroller = container.querySelector( '[class*="_scroll_"]' ) as HTMLDivElement;
		setScrollMetrics( scroller, { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 } );

		useStudioAssistantQuotaMock.mockReturnValue( {
			data: makeQuota( {} ),
			isLoading: false,
			isFetching: false,
			refetch: vi.fn(),
		} );
		rerender( <SessionView sessionId="session-1" /> );

		expect( container.querySelector( '[class*="_scroll_"]' ) ).toBe( scroller );
		expect( scroller.scrollTop ).toBe( 1000 );

		setScrollMetrics( scroller, { scrollTop: 100, scrollHeight: 1000, clientHeight: 400 } );
		fireEvent.scroll( scroller );
		await waitFor( () => expect( jumpButton() ).toHaveAttribute( 'data-visible' ) );
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

		expect( container.querySelectorAll( '[class*="fadeToSurface"]' ) ).toHaveLength( 1 );
	} );

	describe( 'composer notices', () => {
		const PAYMENT_NOTICE = 'Add a payment method to use WordPress.com AI.';

		function renderLoadedChat() {
			useSessionMock.mockReturnValue( {
				data: makeLoadedSession(),
				isLoading: false,
				error: null,
			} );
			return render( <SessionView sessionId="session-1" /> );
		}

		it( 'runs an Anthropic-key chat while signed out of WordPress.com', () => {
			accessState.user = null;
			useStudioAssistantQuotaMock.mockReturnValue( { data: undefined, isLoading: false } );
			aiSettingsState.data = { provider: 'anthropic-api-key', hasAnthropicApiKey: true };

			renderLoadedChat();

			expect( screen.getByTestId( 'composer' ) ).toBeEmptyDOMElement();
			expect( composerProps.current?.notice ).toBeUndefined();
		} );

		it( 'asks a signed-out WordPress.com chat to connect a provider', () => {
			accessState.user = null;
			useStudioAssistantQuotaMock.mockReturnValue( { data: undefined, isLoading: false } );

			renderLoadedChat();
			fireEvent.click( screen.getByRole( 'button', { name: 'Connect' } ) );

			expect(
				screen.getByText( 'Connect a provider to build and edit your site.' )
			).toBeInTheDocument();
			expect( accessState.openSettings ).toHaveBeenCalledWith( 'ai' );
		} );

		it( 'keeps the transcript readable above a payment notice on WordPress.com chats only', () => {
			useStudioAssistantQuotaMock.mockReturnValue( {
				data: makeQuota( { hasPaymentMethod: false } ),
				isLoading: false,
			} );

			const { rerender } = renderLoadedChat();
			expect( screen.getByTestId( 'conversation' ) ).toBeInTheDocument();
			expect( screen.getByText( PAYMENT_NOTICE ) ).toBeInTheDocument();
			expect( screen.getByRole( 'button', { name: 'Set up' } ) ).toBeInTheDocument();

			aiSettingsState.data = { provider: 'anthropic-api-key', hasAnthropicApiKey: true };
			rerender( <SessionView sessionId="session-1" /> );
			expect( screen.queryByText( PAYMENT_NOTICE ) ).not.toBeInTheDocument();
		} );

		it( 'asks a blocked account to connect a different provider', () => {
			useStudioAssistantQuotaMock.mockReturnValue( {
				data: { ...makeQuota( {} ), studioCodeAiHasAccess: false, studioCodeAiAccess: 'blocked' },
				isLoading: false,
			} );

			renderLoadedChat();

			expect(
				screen.getByText( 'Connect a different provider to continue this chat.' )
			).toBeInTheDocument();
		} );

		it( 'stays in the chat while offline', () => {
			accessState.offline = true;

			renderLoadedChat();

			expect(
				screen.getByText( 'You are offline. Reconnect to send a message.' )
			).toBeInTheDocument();
			expect( screen.getByTestId( 'conversation' ) ).toBeInTheDocument();
			expect( navigateMock ).not.toHaveBeenCalled();
		} );

		it( 'reads an unreachable WordPress.com as offline, even when the browser reports online', () => {
			const refetchQuota = vi.fn();
			useStudioAssistantQuotaMock.mockReturnValue( {
				data: undefined,
				isLoading: false,
				isError: true,
				error: new Error( 'offline' ),
				refetch: refetchQuota,
			} );

			renderLoadedChat();
			fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );

			expect(
				screen.getByText( 'You are offline. Reconnect to send a message.' )
			).toBeInTheDocument();
			expect( refetchQuota ).toHaveBeenCalled();
		} );

		it( 'offers a retry when the provider settings or usage fail to load', () => {
			const refetchQuota = vi.fn();
			useStudioAssistantQuotaMock.mockReturnValue( {
				data: undefined,
				isLoading: false,
				isError: true,
				refetch: refetchQuota,
			} );

			const { rerender } = renderLoadedChat();
			expect( screen.getByText( 'AI usage is currently unavailable.' ) ).toBeInTheDocument();
			fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
			expect( refetchQuota ).toHaveBeenCalled();
			expect( aiSettingsState.refetch ).toHaveBeenCalled();

			aiSettingsState.isError = true;
			rerender( <SessionView sessionId="session-1" /> );
			expect( screen.getByText( 'Couldn’t load your AI provider.' ) ).toBeInTheDocument();
		} );

		it( 'fails open when the quota is unknown', () => {
			useStudioAssistantQuotaMock.mockReturnValue( { data: undefined, isLoading: false } );

			renderLoadedChat();

			expect( composerProps.current?.notice ).toBeUndefined();
		} );
	} );

	it( 'settles on the composer when the quota request fails', async () => {
		const actual = await vi.importActual< typeof import('@/data/queries/use-assistant-quota') >(
			'@/data/queries/use-assistant-quota'
		);
		useStudioAssistantQuotaMock.mockImplementation( actual.useStudioAssistantQuota );
		connectorMock.getAuthUser.mockResolvedValue( { id: 1 } );
		connectorMock.getStudioAssistantQuota.mockRejectedValue( new Error( 'offline' ) );
		useSessionMock.mockReturnValue( { data: makeLoadedSession(), isLoading: false, error: null } );
		const queryClient = new QueryClient( { defaultOptions: { queries: { retry: false } } } );

		render(
			<QueryClientProvider client={ queryClient }>
				<SessionView sessionId="session-1" />
			</QueryClientProvider>
		);

		await screen.findByTestId( 'composer' );
		await act( () => new Promise( ( resolve ) => setTimeout( resolve, 50 ) ) );
		expect( screen.getByTestId( 'composer' ) ).toBeInTheDocument();
		expect( connectorMock.getStudioAssistantQuota ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'keeps the composer while a failed quota request is retried', async () => {
		const actual = await vi.importActual< typeof import('@/data/queries/use-assistant-quota') >(
			'@/data/queries/use-assistant-quota'
		);
		useStudioAssistantQuotaMock.mockImplementation( actual.useStudioAssistantQuota );
		connectorMock.getAuthUser.mockResolvedValue( { id: 1 } );
		connectorMock.getStudioAssistantQuota.mockRejectedValue( new Error( 'offline' ) );
		useSessionMock.mockReturnValue( { data: makeLoadedSession(), isLoading: false, error: null } );
		const queryClient = new QueryClient( { defaultOptions: { queries: { retry: false } } } );

		render(
			<QueryClientProvider client={ queryClient }>
				<SessionView sessionId="session-1" />
			</QueryClientProvider>
		);
		await screen.findByTestId( 'composer' );

		connectorMock.getStudioAssistantQuota.mockReturnValue( new Promise( () => {} ) );
		await act( async () => {
			void queryClient.refetchQueries( { queryKey: actual.ASSISTANT_QUOTA_QUERY_KEY } );
			await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
		} );

		expect( screen.getByTestId( 'composer' ) ).toBeInTheDocument();
		expect( screen.queryByTestId( 'composer-skeleton' ) ).not.toBeInTheDocument();
	} );

	describe( 'scroll anchoring', () => {
		function layoutAt( scroller: HTMLElement, metrics: { scrollHeight: number } ) {
			setScrollMetrics( scroller, { scrollTop: 0, clientHeight: 600, ...metrics } );
		}

		function withPromptsAt( ...tops: number[] ) {
			return {
				data: {
					summary: { id: 'session-1' },
					entries: tops.map( ( top, index ) => ( { id: `prompt-${ index }`, top } ) ),
				} as unknown as LoadedAiSession,
				isLoading: false as const,
				error: null,
			};
		}

		beforeEach( () => {
			vi.spyOn( Element.prototype, 'getBoundingClientRect' ).mockImplementation( function (
				this: Element
			) {
				return { top: Number( ( this as HTMLElement ).dataset.top ?? 0 ) } as DOMRect;
			} );
		} );

		afterEach( () => {
			vi.restoreAllMocks();
		} );

		it( 'opens a long chat at its last prompt, with a way back to the latest', async () => {
			useSessionMock.mockReturnValue( withPromptsAt( 100, 900, 1500 ) );
			// Lay the scroller out before it is wired, as the browser would.
			vi.spyOn( HTMLElement.prototype, 'scrollHeight', 'get' ).mockReturnValue( 3000 );
			vi.spyOn( HTMLElement.prototype, 'clientHeight', 'get' ).mockReturnValue( 600 );

			const { container } = render( <SessionView sessionId="session-1" /> );
			const scroller = container.querySelector( '[class*="_scroll_"]' ) as HTMLDivElement;

			// The last prompt sits at the top, with a peek of the turn before it.
			expect( scroller.scrollTop ).toBe( 1436 );
			await waitFor( () => expect( jumpButton() ).toHaveAttribute( 'data-visible' ) );
		} );

		it( 'pins a new prompt near the top while its reply streams below', () => {
			useSessionMock.mockReturnValue( withPromptsAt( 0 ) );
			const { container, rerender } = render( <SessionView sessionId="session-1" /> );
			const scroller = container.querySelector( '[class*="_scroll_"]' ) as HTMLDivElement;
			const spacer = scroller.lastElementChild as HTMLDivElement;

			// The reply so far ends 100px below the new prompt.
			layoutAt( scroller, { scrollHeight: 1236 } );
			spacer.dataset.top = '800';
			useSessionMock.mockReturnValue( withPromptsAt( 0, 700 ) );
			rerender( <SessionView sessionId="session-1" /> );

			// The spacer fills the view below the reply, so scrolling to the end
			// leaves the prompt 64px from the top.
			expect( spacer ).toHaveStyle( { height: '436px' } );
			expect( scroller.scrollTop ).toBe( 1236 );
			expect( jumpButton() ).not.toHaveAttribute( 'data-visible' );

			// Once the reply outgrows the view, the spacer is gone and the view
			// follows the reply.
			spacer.dataset.top = '1600';
			layoutAt( scroller, { scrollHeight: 1800 } );
			useSessionMock.mockReturnValue( withPromptsAt( 0, 700 ) );
			rerender( <SessionView sessionId="session-1" /> );
			expect( spacer ).toHaveStyle( { height: '0px' } );
			expect( scroller.scrollTop ).toBe( 1800 );
		} );
	} );

	it( 'starts a stopped site on send only when auto-start is on', async () => {
		sitesState.data = [ { ...OWNER_SITE, running: false } ];
		useSessionMock.mockReturnValue( { data: makeOwnedSession(), isLoading: false, error: null } );

		const { rerender } = render( <SessionView sessionId="session-1" /> );
		await composerProps.current?.onSend( 'Hi' );
		expect( siteMocks.startSite ).not.toHaveBeenCalled();

		siteMocks.preferences = { autoStartSiteOnChat: true };
		rerender( <SessionView sessionId="session-1" /> );
		await composerProps.current?.onSend( 'Hi' );
		expect( siteMocks.startSite ).toHaveBeenCalledWith( OWNER_SITE.id );
	} );

	it( 'offers a stopped site its last screenshot, under the site actions', () => {
		sitesState.data = [ OWNER_SITE ];
		useSessionMock.mockReturnValue( { data: makeOwnedSession(), isLoading: false, error: null } );

		const { rerender } = render( <SessionView sessionId="session-1" /> );
		expect( screen.getByTestId( 'stopped-site-preview' ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'site-header-space' ) ).toBeInTheDocument();

		sitesState.data = [ { ...OWNER_SITE, running: true } ];
		rerender( <SessionView sessionId="session-1" /> );
		expect( screen.queryByTestId( 'stopped-site-preview' ) ).not.toBeInTheDocument();
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
			isScrolledAwayFromLatest( { scrollTop: 595, scrollHeight: 1000, clientHeight: 400 } )
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
