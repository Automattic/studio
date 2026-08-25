import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import {
	useDeleteAllSnapshots,
	useSnapshotUsage,
	useSnapshots,
} from '@/data/queries/use-snapshots';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { setUsageExplorationScenario } from '@/data/usage-exploration';
import { useOffline } from '@/hooks/use-offline';
import { UsagePanel } from './usage-panel';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

vi.mock( '@wordpress/ui', () => ( {
	Button: Object.assign(
		( {
			children,
			loading,
			loadingAnnouncement,
			tone,
			variant,
			size,
			...props
		}: ButtonHTMLAttributes< HTMLButtonElement > & {
			children?: ReactNode;
			loading?: boolean;
			loadingAnnouncement?: string;
			tone?: string;
			variant?: string;
			size?: string;
		} ) => {
			void tone;
			void size;
			return (
				<button { ...props } data-variant={ variant }>
					{ loading ? loadingAnnouncement : children }
				</button>
			);
		},
		{ Icon: () => null }
	),
	IconButton: ( {
		label,
		disabled,
		onClick,
	}: {
		label: string;
		disabled?: boolean;
		onClick?: () => void;
	} ) => <button type="button" aria-label={ label } disabled={ disabled } onClick={ onClick } />,
	Tooltip: {
		Root: ( { children }: { children: ReactNode } ) => <>{ children }</>,
		Trigger: ( { render }: { render: ReactNode } ) => render,
		Popup: ( { children }: { children: ReactNode } ) => <span>{ children }</span>,
		Positioner: () => null,
	},
} ) );

vi.mock( '@/components/menu', () => ( {
	Root: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	Trigger: ( { render: trigger }: { render: ReactNode } ) => trigger,
	Popup: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	Item: ( {
		children,
		disabled,
		onClick,
	}: {
		children: ReactNode;
		disabled?: boolean;
		onClick?: () => void;
	} ) => (
		<button type="button" disabled={ disabled } onClick={ onClick }>
			{ children }
		</button>
	),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
	useLogin: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-assistant-quota', () => ( {
	useStudioAssistantQuota: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-snapshots', () => ( {
	useDeleteAllSnapshots: vi.fn(),
	useSnapshotUsage: vi.fn(),
	useSnapshots: vi.fn(),
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-locale', () => ( {
	useUserLocale: vi.fn(),
} ) );

vi.mock( '@/components/purchase-credits-dialog', () => ( {
	PurchaseCreditsDialog: () => null,
} ) );

vi.mock( '@/components/ai-credits-details-dialog', () => ( {
	AiCreditsDetailsDialog: ( { open }: { open: boolean } ) =>
		open ? (
			<div role="dialog" aria-label="How AI credits work">
				You get a welcome gift of 1.5 million AI credits. AI credits do not expire, including
				credits you purchase later. Different models use AI credits at different rates. AI credits
				measure Studio usage; they are different from the tokens an AI provider uses to count pieces
				of text.
			</div>
		) : null,
} ) );

// Reached through `useAgenticFeatures`, which reads the agentic-features
// preference; this panel has no QueryClientProvider.
vi.mock( '@/data/queries/use-user-preferences', () => ( {
	USER_PREFERENCES_QUERY_KEY: [ 'user-preferences' ],
	useUserPreferences: () => ( { data: { agenticFeaturesEnabled: true }, isLoading: false } ),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useStudioAssistantQuotaMock = vi.mocked( useStudioAssistantQuota, { partial: true } );
const useAuthUserMock = vi.mocked( useAuthUser );
const useLoginMock = vi.mocked( useLogin );
const useDeleteAllSnapshotsMock = vi.mocked( useDeleteAllSnapshots );
const useSnapshotUsageMock = vi.mocked( useSnapshotUsage );
const useSnapshotsMock = vi.mocked( useSnapshots );
const useOfflineMock = vi.mocked( useOffline );
const useUserLocaleMock = vi.mocked( useUserLocale );

describe( 'UsagePanel', () => {
	const loginMutate = vi.fn();
	const deleteSnapshotsMutate = vi.fn();
	const confirmDeleteAllPreviewSites = vi.fn();
	const openExternalUrl = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		setUsageExplorationScenario( 'warning' );

		confirmDeleteAllPreviewSites.mockResolvedValue( true );
		openExternalUrl.mockResolvedValue( undefined );
		// `agenticRequiresAuth` lets the real useAgenticFeatures derive the
		// signed-out/offline reason from the mocked auth + offline hooks.
		useConnectorMock.mockReturnValue( {
			confirmDeleteAllPreviewSites,
			openExternalUrl,
			agenticRequiresAuth: true,
		} as never );
		useOfflineMock.mockReturnValue( false );
		useUserLocaleMock.mockReturnValue( 'en' );
		useAuthUserMock.mockReturnValue( {
			data: { id: 1, displayName: 'Ada Lovelace', email: 'ada@example.com' },
			isLoading: false,
		} as never );
		useLoginMock.mockReturnValue( { mutate: loginMutate, isPending: false } as never );
		useSnapshotsMock.mockReturnValue( { data: [], isLoading: false } as never );
		useSnapshotUsageMock.mockReturnValue( {
			data: { siteCount: 2, siteLimit: 10, siteCreationBlocked: false },
			isLoading: false,
		} as never );
		useDeleteAllSnapshotsMock.mockReturnValue( {
			mutate: deleteSnapshotsMutate,
			isPending: false,
			error: null,
		} as never );
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: {
				costUsage: 0,
				costCap: 100,
				costResetDate: '2026-08-01T12:00:00',
				studioCodeAiHasAccess: true,
				studioCodeAiAccess: 'granted',
			},
			isLoading: false,
		} as never );
	} );

	it( 'renders AI credits and preview site usage for the signed-in user', () => {
		render( <UsagePanel /> );

		expect( screen.getByRole( 'heading', { name: 'Usage' } ) ).toBeInTheDocument();
		expect( screen.getByText( '1,200,000 of 1,500,000 AI credits used' ) ).toBeInTheDocument();
		expect( screen.getByText( '300,000 available' ) ).toBeInTheDocument();
		expect(
			screen.getByText( "Top up now so your next build doesn't stop short." )
		).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Add AI credits' } ) ).toHaveAttribute(
			'data-variant',
			'outline'
		);
		expect( screen.getByText( '2 of 10 active preview sites' ) ).toBeInTheDocument();
		expect( useSnapshotsMock ).toHaveBeenCalledWith( 1 );
		expect( useSnapshotUsageMock ).toHaveBeenCalledWith( 1 );
		expect( useDeleteAllSnapshotsMock ).toHaveBeenCalledWith( 1 );
	} );

	it( 'shows the welcome-credit message before the usage warnings', () => {
		setUsageExplorationScenario( 'fresh' );
		render( <UsagePanel /> );

		expect(
			screen.getByText( 'Your first 1.5 million AI credits are on us.' )
		).toBeInTheDocument();
	} );

	it( 'updates the credit callout at 90% usage', () => {
		setUsageExplorationScenario( 'critical' );
		render( <UsagePanel /> );

		expect(
			screen.getByText( "You're on a roll. Top up now and keep building." )
		).toBeInTheDocument();
	} );

	it( 'renders the exhausted exploration state', () => {
		setUsageExplorationScenario( 'exhausted' );
		render( <UsagePanel /> );

		expect( screen.getByText( '1,500,000 of 1,500,000 AI credits used' ) ).toBeInTheDocument();
		expect( screen.getByText( '0 available' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Your next idea is ready when you are. Top up to bring it to life.' )
		).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Add AI credits' } ) ).toHaveAttribute(
			'data-variant',
			'solid'
		);
	} );

	it( 'shows purchased credits as a balance without an activity ledger', () => {
		setUsageExplorationScenario( 'extra-healthy' );

		render( <UsagePanel /> );

		expect( screen.queryByText( 'Recent activity' ) ).not.toBeInTheDocument();
		expect(
			screen.getByText( 'Keep the ideas flowing. Stock up for whatever you build next.' )
		).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Add AI credits' } ) ).toBeInTheDocument();
		expect( screen.getAllByTestId( 'usage-progress-bar' ) ).toHaveLength( 2 );
	} );

	it( 'explains the welcome gift and how AI credits work', () => {
		render( <UsagePanel /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'How AI credits work' } ) );

		expect( screen.getByRole( 'dialog', { name: 'How AI credits work' } ) ).toHaveTextContent(
			'You get a welcome gift of 1.5 million AI credits.'
		);
		expect( screen.getByRole( 'dialog', { name: 'How AI credits work' } ) ).toHaveTextContent(
			'AI credits do not expire'
		);
		expect( screen.getByRole( 'dialog', { name: 'How AI credits work' } ) ).toHaveTextContent(
			'Different models use AI credits at different rates.'
		);
		expect( screen.getByRole( 'dialog', { name: 'How AI credits work' } ) ).toHaveTextContent(
			'they are different from the tokens an AI provider uses to count pieces of text.'
		);
	} );

	it( 'offers prototype states for extra-credit usage', () => {
		setUsageExplorationScenario( 'extra-exhausted' );
		render( <UsagePanel /> );

		expect( screen.getAllByTestId( 'usage-progress-bar' ) ).toHaveLength( 2 );
	} );

	it( 'resets the combined meter after credits are added', () => {
		setUsageExplorationScenario( 'extra-reserve' );
		render( <UsagePanel /> );

		expect( screen.getByText( '0 of 1,460,000 AI credits used' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Welcome AI credits' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Purchased AI credits' ) ).not.toBeInTheDocument();
		expect( screen.getAllByTestId( 'usage-progress-bar' ) ).toHaveLength( 2 );
	} );

	it( 'keeps the prototype meter when the quota includes per-pool balance fields', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: {
				costUsage: 25,
				costCap: 100,
				costResetDate: '2026-08-01T12:00:00',
				allowanceRemaining: 960000,
				purchasedRemaining: 150000,
			},
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		expect( screen.queryByText( /credits remaining/ ) ).not.toBeInTheDocument();
		expect( screen.getByText( '1,200,000 of 1,500,000 AI credits used' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'How AI credits work' } ) ).toBeInTheDocument();
	} );

	it( 'opens the credits explainer dialog from the help icon', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: { costUsage: 0, costCap: 0, allowanceRemaining: 960000, purchasedRemaining: 0 },
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'How AI credits work' } ) );

		expect( screen.getByRole( 'dialog', { name: 'How AI credits work' } ) ).toHaveTextContent(
			'You get a welcome gift of 1.5 million AI credits.'
		);
	} );

	it( 'lets access gates take precedence over the credit balances', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: {
				costUsage: 0,
				costCap: 100,
				costResetDate: '2026-08-01T12:00:00',
				studioCodeAiHasAccess: false,
				studioCodeAiAccess: 'blocked',
				allowanceRemaining: 960000,
				purchasedRemaining: 0,
			},
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		expect(
			screen.getByText( /Studio Code AI is blocked for this WordPress.com account/ )
		).toBeInTheDocument();
		expect( screen.queryByText( /Free credits remaining/ ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Add AI credits' } ) ).not.toBeInTheDocument();
	} );

	it( 'shows the suspension copy for an explicitly blocked account', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: {
				costUsage: 0,
				costCap: 100,
				costResetDate: '2026-08-01T12:00:00',
				studioCodeAiHasAccess: false,
				studioCodeAiAccess: 'blocked',
			},
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		expect(
			screen.getByText( /Studio Code AI is blocked for this WordPress.com account/ )
		).toBeInTheDocument();
		expect( screen.getByRole( 'link', { name: 'contact WordPress.com support' } ) ).toHaveAttribute(
			'href',
			'https://wordpress.com/support/contact/'
		);
	} );

	it( 'shows the request-access copy, not the suspension copy, for an ungranted default account', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: {
				costUsage: 0,
				costCap: 100,
				costResetDate: '2026-08-01T12:00:00',
				studioCodeAiHasAccess: false,
				studioCodeAiAccess: 'default',
			},
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		expect(
			screen.getByText( /Studio Code AI is currently available through limited beta access/ )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: 'developer.wordpress.com/studio/studio-code-beta' } )
		).toHaveAttribute( 'href', 'https://developer.wordpress.com/studio/studio-code-beta/' );
		expect(
			screen.queryByText( /Studio Code AI is blocked for this WordPress.com account/ )
		).not.toBeInTheDocument();
	} );

	it( 'tells an ungranted account with spend this cycle that beta access is now required', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: {
				costUsage: 3,
				costCap: 100,
				costResetDate: '2026-08-01T12:00:00',
				studioCodeAiHasAccess: false,
				studioCodeAiAccess: 'default',
			},
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		expect(
			screen.getByText( /Thanks for participating in the Studio Code AI beta/ )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: 'developer.wordpress.com/studio/studio-code-beta' } )
		).toBeInTheDocument();
	} );

	it( 'shows the exploration usage when access is granted through a default-allow policy', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: {
				costUsage: 25,
				costCap: 100,
				costResetDate: '2026-08-01T12:00:00',
				studioCodeAiHasAccess: true,
				studioCodeAiAccess: 'default',
			},
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		expect( screen.getByText( '1,200,000 of 1,500,000 AI credits used' ) ).toBeInTheDocument();
	} );

	it( 'confirms through the connector before deleting all preview sites', async () => {
		render( <UsagePanel /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Delete all preview sites' } ) );

		await waitFor( () => expect( confirmDeleteAllPreviewSites ).toHaveBeenCalledTimes( 1 ) );
		expect( deleteSnapshotsMutate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not delete when the confirmation is declined', async () => {
		confirmDeleteAllPreviewSites.mockResolvedValue( false );

		render( <UsagePanel /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Delete all preview sites' } ) );

		await waitFor( () => expect( confirmDeleteAllPreviewSites ).toHaveBeenCalledTimes( 1 ) );
		expect( deleteSnapshotsMutate ).not.toHaveBeenCalled();
	} );

	it( 'keeps AI usage visible while preview usage loads', () => {
		// Preview usage is still cached from before the delete, so the bar would
		// otherwise keep its old fill next to a "Loading…" row.
		useDeleteAllSnapshotsMock.mockReturnValue( {
			mutate: deleteSnapshotsMutate,
			isPending: true,
			error: null,
		} as never );

		render( <UsagePanel /> );

		expect( screen.getAllByText( 'Loading…' ) ).toHaveLength( 1 );
		const bars = screen.getAllByTestId( 'usage-progress-bar' );
		expect( bars ).toHaveLength( 2 );
		expect( bars[ 0 ].firstElementChild ).toHaveStyle( { inlineSize: '80%' } );
		expect( bars[ 1 ].firstElementChild ).toHaveStyle( { inlineSize: '0%' } );
	} );

	it( 'replaces figures and actions with the offline notice while offline', () => {
		useOfflineMock.mockReturnValue( true );
		render( <UsagePanel /> );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( "You're offline" );
		// Cached figures are stale and can't be refreshed, so they stay hidden.
		expect( screen.queryByText( /of monthly limit used/ ) ).not.toBeInTheDocument();
		expect( screen.queryByText( /active preview site/ ) ).not.toBeInTheDocument();
		expect( screen.getAllByRole( 'img', { name: 'Unavailable' } ) ).toHaveLength( 2 );
		expect(
			screen.queryByRole( 'button', { name: 'Delete all preview sites' } )
		).not.toBeInTheDocument();
		expect( screen.queryByLabelText( 'Sign in to Studio' ) ).not.toBeInTheDocument();
	} );

	it( 'surfaces a deletion error inline', () => {
		useDeleteAllSnapshotsMock.mockReturnValue( {
			mutate: deleteSnapshotsMutate,
			isPending: false,
			error: new Error( 'delete failed' ),
		} as never );

		render( <UsagePanel /> );

		expect(
			screen.getByText( 'An error occurred while deleting all preview sites. Please try again.' )
		).toBeInTheDocument();
	} );

	it( 'shows the sign-in banner and no credits copy when signed out', () => {
		useAuthUserMock.mockReturnValue( { data: null, isLoading: false } as never );

		render( <UsagePanel /> );

		expect( screen.getByLabelText( 'Sign in to Studio' ) ).toBeInTheDocument();
		expect( screen.queryByText( /active preview site/ ) ).not.toBeInTheDocument();
		expect( screen.getAllByRole( 'img', { name: 'Unavailable' } ) ).toHaveLength( 2 );
		// Studio Code needs an account, so the Alpha pricing copy stays hidden.
		expect(
			screen.queryByText(
				'AI credits are currently free while Studio Code is in Alpha. Build, iterate, and experiment, but know that credits will eventually have a cost.'
			)
		).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Log in with WordPress.com' } ) );

		expect( loginMutate ).toHaveBeenCalled();
	} );
} );
