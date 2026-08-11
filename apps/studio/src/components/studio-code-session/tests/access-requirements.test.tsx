// Run tests: npm test -- apps/studio/src/components/studio-code-session/tests/access-requirements.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioCodeSession } from '..';
import { queryClient } from '../query-client';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';

const { mockIpc, quotaState } = vi.hoisted( () => ( {
	mockIpc: {
		loadAiSession: vi.fn(),
		createAiSession: vi.fn(),
		markAiMessageEdited: vi.fn(),
		openURL: vi.fn(),
	},
	quotaState: {
		data: undefined as Partial< StudioAssistantQuota > | undefined,
		isLoading: false,
		isFetching: false,
		refetch: vi.fn(),
	},
} ) );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => mockIpc,
} ) );

vi.mock( 'src/hooks/use-auth', () => ( {
	useAuth: () => ( { isAuthenticated: true, authenticate: vi.fn() } ),
} ) );

vi.mock( 'src/stores/wpcom-api', () => ( {
	useGetStudioAssistantQuota: () => quotaState,
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

function setQuota( data: Partial< StudioAssistantQuota > | undefined ) {
	quotaState.data = data;
}

beforeEach( () => {
	vi.clearAllMocks();
	localStorage.clear();
	queryClient.clear();
	quotaState.isLoading = false;
	quotaState.isFetching = false;
	setQuota( undefined );
	mockIpc.loadAiSession.mockResolvedValue( { summary: { id: 'session-1' }, entries: [] } );
	mockIpc.createAiSession.mockResolvedValue( { id: 'session-1' } );
} );

describe( 'StudioCodeSession access requirements gate', () => {
	it( 'shows the payment requirement without a saved payment method', async () => {
		setQuota( { hasPaymentMethod: false, emailVerified: true } );

		render( <StudioCodeSession selectedSite={ selectedSite } /> );

		await screen.findByText( 'Studio Code Beta' );
		expect( screen.getByRole( 'button', { name: /add payment method/i } ) ).toBeInTheDocument();
		expect( screen.queryByTestId( 'composer' ) ).not.toBeInTheDocument();
	} );

	it( 'still shows the payment requirement when the email is also unverified', async () => {
		setQuota( { hasPaymentMethod: false, emailVerified: false } );

		render( <StudioCodeSession selectedSite={ selectedSite } /> );

		await screen.findByText( 'Studio Code Beta' );
		expect( screen.queryByTestId( 'composer' ) ).not.toBeInTheDocument();
	} );

	it( 'ignores an unverified email when a payment method exists', async () => {
		setQuota( { hasPaymentMethod: true, emailVerified: false } );

		render( <StudioCodeSession selectedSite={ selectedSite } /> );

		await screen.findByTestId( 'composer' );
	} );

	it( 'opens the browser and waits after choosing to add a payment method', async () => {
		setQuota( { hasPaymentMethod: false, emailVerified: true } );

		render( <StudioCodeSession selectedSite={ selectedSite } /> );

		await userEvent.click( await screen.findByRole( 'button', { name: /add payment method/i } ) );

		expect( mockIpc.openURL ).toHaveBeenCalledWith(
			'https://my.wordpress.com/me/billing/payment-methods/add'
		);
		await screen.findByText( 'Finish adding your payment method' );

		await userEvent.click( screen.getByRole( 'button', { name: /check again/i } ) );
		expect( quotaState.refetch ).toHaveBeenCalled();
	} );

	it( 'renders the session when both requirements are met', async () => {
		setQuota( { hasPaymentMethod: true, emailVerified: true } );

		render( <StudioCodeSession selectedSite={ selectedSite } /> );

		await screen.findByTestId( 'composer' );
	} );

	it( 'fails open when the quota is unavailable', async () => {
		setQuota( undefined );

		render( <StudioCodeSession selectedSite={ selectedSite } /> );

		await screen.findByTestId( 'composer' );
	} );

	it( 'asks an ungranted account to apply for beta access', async () => {
		setQuota( {
			hasPaymentMethod: true,
			emailVerified: true,
			costUsage: 0,
			studioCodeAiHasAccess: false,
			studioCodeAiAccess: 'default',
		} );

		render( <StudioCodeSession selectedSite={ selectedSite } /> );

		await screen.findByText( 'Studio Code AI is currently available through limited beta access.' );
		expect( screen.queryByTestId( 'composer' ) ).not.toBeInTheDocument();

		await userEvent.click( screen.getByRole( 'button', { name: /apply for access/i } ) );
		expect( mockIpc.openURL ).toHaveBeenCalledWith(
			'https://developer.wordpress.com/studio/studio-code-beta/'
		);
		await screen.findByText( 'Finish applying for access' );
	} );

	it( 'shows the apply gate before the payment gate when both are missing', async () => {
		setQuota( {
			hasPaymentMethod: false,
			emailVerified: true,
			costUsage: 0,
			studioCodeAiHasAccess: false,
			studioCodeAiAccess: 'default',
		} );

		render( <StudioCodeSession selectedSite={ selectedSite } /> );

		await screen.findByRole( 'button', { name: /apply for access/i } );
		expect(
			screen.queryByRole( 'button', { name: /add payment method/i } )
		).not.toBeInTheDocument();
	} );

	it( 'tells an ungranted account with spend this cycle that access is now limited', async () => {
		setQuota( {
			hasPaymentMethod: true,
			emailVerified: true,
			costUsage: 3,
			studioCodeAiHasAccess: false,
			studioCodeAiAccess: 'default',
		} );

		render( <StudioCodeSession selectedSite={ selectedSite } /> );

		await screen.findByText(
			'Thanks for participating in the Studio Code AI beta. Access is now limited.'
		);
	} );

	it( 'shows the suspension copy with a support link for a blocked account', async () => {
		setQuota( {
			hasPaymentMethod: true,
			emailVerified: true,
			costUsage: 0,
			studioCodeAiHasAccess: false,
			studioCodeAiAccess: 'blocked',
		} );

		render( <StudioCodeSession selectedSite={ selectedSite } /> );

		await screen.findByText( /Studio Code AI is blocked for this WordPress.com account/ );
		expect( screen.queryByTestId( 'composer' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: /apply for access/i } ) ).not.toBeInTheDocument();

		await userEvent.click( screen.getByRole( 'button', { name: /contact support/i } ) );
		expect( mockIpc.openURL ).toHaveBeenCalledWith( 'https://wordpress.com/support/contact/' );
	} );
} );
