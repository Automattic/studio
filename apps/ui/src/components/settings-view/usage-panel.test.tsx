import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
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
	Button: ( {
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
	IconButton: ( { label, disabled }: { label: string; disabled?: boolean } ) => (
		<button type="button" aria-label={ label } disabled={ disabled } />
	),
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

vi.mock( '@/data/queries/use-user-locale', () => ( {
	useUserLocale: vi.fn(),
} ) );

vi.mock( '@/components/purchase-credits-dialog', () => ( {
	PurchaseCreditsDialog: () => null,
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
const useUserLocaleMock = vi.mocked( useUserLocale );

describe( 'UsagePanel', () => {
	const loginMutate = vi.fn();
	const deleteSnapshotsMutate = vi.fn();
	const confirmDeleteAllPreviewSites = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		setUsageExplorationScenario( 'warning' );

		confirmDeleteAllPreviewSites.mockResolvedValue( true );
		// `agenticRequiresAuth` lets the real useAgenticFeatures derive the
		// signed-out/offline reason from the mocked auth + offline hooks.
		useConnectorMock.mockReturnValue( {
			confirmDeleteAllPreviewSites,
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
	} );

	it( 'renders AI credits and preview site usage for the signed-in user', () => {
		render( <UsagePanel /> );

		expect( screen.getByRole( 'heading', { name: 'Usage' } ) ).toBeInTheDocument();
		expect( screen.getByText( '40 / 50' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Extra AI credits' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Add credits' } ) ).toBeInTheDocument();
		expect( screen.getByText( '2 of 10 active preview sites' ) ).toBeInTheDocument();
		expect( useSnapshotsMock ).toHaveBeenCalledWith( 1 );
		expect( useSnapshotUsageMock ).toHaveBeenCalledWith( 1 );
		expect( useDeleteAllSnapshotsMock ).toHaveBeenCalledWith( 1 );
	} );

	it( 'switches between exploration states', () => {
		render( <UsagePanel /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Monthly allowance 100%' } ) );

		expect( screen.getByText( '50 / 50' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Monthly allowance used' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Keep chatting with extra credits' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Add credits to continue now. Extra credits do not expire.' )
		).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Add credits' } ) ).toBeInTheDocument();
	} );

	it( 'shows purchased credits as a second usage graph', () => {
		setUsageExplorationScenario( 'extra-healthy' );

		render( <UsagePanel /> );

		expect( screen.getByText( '18 / 50 used' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Add credits' } ) ).toBeInTheDocument();
		expect( screen.getAllByTestId( 'usage-progress-bar' ) ).toHaveLength( 3 );
	} );

	it( 'offers prototype states for extra-credit usage', () => {
		render( <UsagePanel /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Extra credits 100%' } ) );

		expect( screen.getByText( 'Extra AI credits used' ) ).toBeInTheDocument();
		expect( screen.getByText( '50 / 50 used' ) ).toBeInTheDocument();
		expect( screen.getAllByTestId( 'usage-progress-bar' ) ).toHaveLength( 3 );
	} );

	it( 'shows extra credits held in reserve before the monthly allowance is used', () => {
		render( <UsagePanel /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Extra credits In reserve' } ) );

		expect( screen.getByText( '18 / 50' ) ).toBeInTheDocument();
		expect( screen.getByText( '0 / 50 used' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Extra AI credits' ) ).toBeInTheDocument();
		expect( screen.getAllByTestId( 'usage-progress-bar' ) ).toHaveLength( 3 );
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
