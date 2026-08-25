import '@testing-library/jest-dom/vitest';
import { getAddAiCreditsUrl } from '@studio/common/lib/studio-assistant-quota';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAppGlobals } from '@/data/queries/use-app-globals';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import {
	useDeleteAllSnapshots,
	useSnapshotUsage,
	useSnapshots,
} from '@/data/queries/use-snapshots';
import { useStudioAssistantTopUpPricing } from '@/data/queries/use-top-up-pricing';
import { useUserLocale } from '@/data/queries/use-user-locale';
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
			void variant;
			void size;
			return <button { ...props }>{ loading ? loadingAnnouncement : children }</button>;
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
} ) );

vi.mock( '@/components/ai-credits-details-dialog', () => ( {
	AiCreditsDetailsDialog: ( { open }: { open: boolean } ) =>
		open ? <div role="dialog">How AI credits work</div> : null,
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

vi.mock( '@/data/queries/use-snapshots', () => ( {
	useDeleteAllSnapshots: vi.fn(),
	useSnapshotUsage: vi.fn(),
	useSnapshots: vi.fn(),
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-assistant-quota', () => ( {
	useStudioAssistantQuota: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-top-up-pricing', () => ( {
	useStudioAssistantTopUpPricing: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-locale', () => ( {
	useUserLocale: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-app-globals', () => ( {
	useAppGlobals: vi.fn(),
} ) );

// Reached through `useAgenticFeatures`, which reads the agentic-features
// preference; this panel has no QueryClientProvider.
vi.mock( '@/data/queries/use-user-preferences', () => ( {
	USER_PREFERENCES_QUERY_KEY: [ 'user-preferences' ],
	useUserPreferences: () => ( { data: { agenticFeaturesEnabled: true }, isLoading: false } ),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useAuthUserMock = vi.mocked( useAuthUser );
const useLoginMock = vi.mocked( useLogin );
const useDeleteAllSnapshotsMock = vi.mocked( useDeleteAllSnapshots );
const useSnapshotUsageMock = vi.mocked( useSnapshotUsage );
const useSnapshotsMock = vi.mocked( useSnapshots );
const useOfflineMock = vi.mocked( useOffline );
const useStudioAssistantQuotaMock = vi.mocked( useStudioAssistantQuota );
const useStudioAssistantTopUpPricingMock = vi.mocked( useStudioAssistantTopUpPricing );
const useUserLocaleMock = vi.mocked( useUserLocale );
const useAppGlobalsMock = vi.mocked( useAppGlobals );

describe( 'UsagePanel', () => {
	const loginMutate = vi.fn();
	const deleteSnapshotsMutate = vi.fn();
	const confirmDeleteAllPreviewSites = vi.fn();
	const openExternalUrl = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();

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
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: undefined,
			isLoading: false,
		} as never );
		useStudioAssistantTopUpPricingMock.mockReturnValue( {
			data: null,
			isLoading: false,
		} as never );
		useUserLocaleMock.mockReturnValue( 'en' );
		useAppGlobalsMock.mockReturnValue( { data: { platform: 'darwin' } } as never );
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
	} );

	it( 'renders AI credits and preview site usage for the signed-in user', () => {
		render( <UsagePanel /> );

		expect( screen.getByRole( 'heading', { name: 'Usage' } ) ).toBeInTheDocument();
		expect(
			screen.getByText(
				'AI credits are currently free while Studio Code is in Alpha. Build, iterate, and experiment, but know that credits will eventually have a cost.'
			)
		).toBeInTheDocument();
		expect( screen.getByText( '2 of 10 active preview sites' ) ).toBeInTheDocument();
		expect( useSnapshotsMock ).toHaveBeenCalledWith( 1 );
		expect( useSnapshotUsageMock ).toHaveBeenCalledWith( 1 );
		expect( useDeleteAllSnapshotsMock ).toHaveBeenCalledWith( 1 );
	} );

	it( 'renders AI usage when a quota with a cost cap is available', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: { costUsage: 25, costCap: 100, costResetDate: '2026-08-01T12:00:00' },
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		expect(
			screen.getByText( '25% of monthly limit used (resets on August 1, 2026)' )
		).toBeInTheDocument();
		expect(
			screen.queryByText(
				'AI credits are currently free while Studio Code is in Alpha. Build, iterate, and experiment, but know that credits will eventually have a cost.'
			)
		).not.toBeInTheDocument();
	} );

	it( 'drops the reset sentence when the server no longer reports a reset date', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: { costUsage: 25, costCap: 100, costResetDate: undefined },
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		expect( screen.getByText( '25% of monthly limit used' ) ).toBeInTheDocument();
		expect( screen.queryByText( /resets on/ ) ).not.toBeInTheDocument();
	} );

	it( 'shows an unavailable message when the quota fetch fails', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: undefined,
			isLoading: false,
			isError: true,
		} as never );

		render( <UsagePanel /> );

		expect(
			screen.getByText( 'Studio Code limits are temporarily unavailable.' )
		).toBeInTheDocument();
		expect(
			screen.queryByText(
				'AI credits are currently free while Studio Code is in Alpha. Build, iterate, and experiment, but know that credits will eventually have a cost.'
			)
		).not.toBeInTheDocument();
	} );

	it( 'falls back to the Alpha copy when the quota has no cost cap', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: { costUsage: 0, costCap: 0 },
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		expect(
			screen.getByText(
				'AI credits are currently free while Studio Code is in Alpha. Build, iterate, and experiment, but know that credits will eventually have a cost.'
			)
		).toBeInTheDocument();
	} );

	it( 'shows remaining credit balances when the quota includes the per-pool fields', () => {
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

		expect( screen.getByText( 'Free credits remaining: 960,000' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Purchased credits remaining: 150,000' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Add AI credits' } ) ).toBeInTheDocument();
		// The credit balances replace the monthly-limit and Alpha designs.
		expect( screen.queryByText( /of monthly limit used/ ) ).not.toBeInTheDocument();
		expect(
			screen.queryByText( /AI credits are currently free while Studio Code is in Alpha/ )
		).not.toBeInTheDocument();
	} );

	it( 'hides the free-credits line once the allowance is exhausted', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: {
				costUsage: 25,
				costCap: 100,
				costResetDate: '2026-08-01T12:00:00',
				allowanceRemaining: 0,
				purchasedRemaining: 0,
			},
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		expect( screen.queryByText( /Free credits remaining/ ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Purchased credits remaining: 0' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Add AI credits' } ) ).toBeInTheDocument();
	} );

	it( 'keeps the old design when the quota has no per-pool balance fields', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: { costUsage: 25, costCap: 100, costResetDate: '2026-08-01T12:00:00' },
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		expect( screen.queryByText( /credits remaining/ ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Add AI credits' } ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'How AI credits work' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByText( '25% of monthly limit used (resets on August 1, 2026)' )
		).toBeInTheDocument();
	} );

	it( 'opens the WordPress.com checkout from the add-credits button', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: { costUsage: 0, costCap: 0, allowanceRemaining: 960000, purchasedRemaining: 0 },
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Add AI credits' } ) );

		expect( openExternalUrl ).toHaveBeenCalledWith(
			getAddAiCreditsUrl( { returnsToDesktop: true } )
		);
	} );

	it( 'offers a button per top-up the store priced, each buying its own quantity', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: { costUsage: 0, costCap: 0, allowanceRemaining: 960000, purchasedRemaining: 0 },
			isLoading: false,
		} as never );
		useStudioAssistantTopUpPricingMock.mockReturnValue( {
			data: {
				currency: 'GBP',
				step: null,
				options: [
					{ credits: 100000, amountMinor: 750, display: '£7.50' },
					{ credits: 500000, amountMinor: 3750, display: '£37.50' },
				],
			},
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		expect( screen.queryByRole( 'button', { name: 'Add AI credits' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByText( '500,000 · £37.50' ) );

		expect( openExternalUrl ).toHaveBeenCalledWith(
			getAddAiCreditsUrl( { returnsToDesktop: true, credits: 500000 } )
		);
	} );

	it( 'drops the return-to-Studio link when running in a browser tab', () => {
		useAppGlobalsMock.mockReturnValue( { data: { platform: 'browser' } } as never );
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: { costUsage: 0, costCap: 0, allowanceRemaining: 960000, purchasedRemaining: 0 },
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Add AI credits' } ) );

		expect( openExternalUrl ).toHaveBeenCalledWith(
			getAddAiCreditsUrl( { returnsToDesktop: false } )
		);
	} );

	it( 'opens the credits explainer dialog from the help icon', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: { costUsage: 0, costCap: 0, allowanceRemaining: 960000, purchasedRemaining: 0 },
			isLoading: false,
		} as never );

		render( <UsagePanel /> );

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'How AI credits work' } ) );

		expect( screen.getByRole( 'dialog' ) ).toHaveTextContent( 'How AI credits work' );
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

	it( 'shows normal usage when access is granted through a default-allow policy', () => {
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

		expect(
			screen.getByText( '25% of monthly limit used (resets on August 1, 2026)' )
		).toBeInTheDocument();
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

	it( 'shows a loading row with an empty progress bar in both sections', () => {
		useStudioAssistantQuotaMock.mockReturnValue( { data: undefined, isLoading: true } as never );
		// Preview usage is still cached from before the delete, so the bar would
		// otherwise keep its old fill next to a "Loading…" row.
		useDeleteAllSnapshotsMock.mockReturnValue( {
			mutate: deleteSnapshotsMutate,
			isPending: true,
			error: null,
		} as never );

		render( <UsagePanel /> );

		expect( screen.getAllByText( 'Loading…' ) ).toHaveLength( 2 );
		const bars = screen.getAllByTestId( 'usage-progress-bar' );
		expect( bars ).toHaveLength( 2 );
		for ( const bar of bars ) {
			expect( bar.firstElementChild ).toHaveStyle( { inlineSize: '0%' } );
		}
	} );

	it( 'replaces figures and actions with the offline notice while offline', () => {
		useOfflineMock.mockReturnValue( true );
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: { costUsage: 25, costCap: 100, costResetDate: '2026-08-01T12:00:00' },
			isLoading: false,
		} as never );

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
