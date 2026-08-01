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

vi.mock( '@/data/queries/use-assistant-quota', () => ( {
	useStudioAssistantQuota: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-locale', () => ( {
	useUserLocale: vi.fn(),
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
const useUserLocaleMock = vi.mocked( useUserLocale );

describe( 'UsagePanel', () => {
	const loginMutate = vi.fn();
	const deleteSnapshotsMutate = vi.fn();
	const confirmDeleteAllPreviewSites = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();

		confirmDeleteAllPreviewSites.mockResolvedValue( true );
		// `agenticRequiresAuth` lets the real useAgenticFeatures derive the
		// signed-out/offline reason from the mocked auth + offline hooks.
		useConnectorMock.mockReturnValue( {
			confirmDeleteAllPreviewSites,
			agenticRequiresAuth: true,
		} as never );
		useOfflineMock.mockReturnValue( false );
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: undefined,
			isLoading: false,
		} as never );
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
