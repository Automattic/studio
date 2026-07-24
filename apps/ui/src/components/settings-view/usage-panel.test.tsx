import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAuthUser } from '@/data/queries/use-auth-user';
import {
	useDeleteAllSnapshots,
	useSnapshotUsage,
	useSnapshots,
} from '@/data/queries/use-snapshots';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useOffline } from '@/hooks/use-offline';
import { AiCreditsSection, PreviewUsageSection } from './usage-panel';
import type { ReactNode } from 'react';

vi.mock( '@wordpress/ui', () => ( {
	Button: ( {
		children,
		disabled,
		onClick,
		loading,
		loadingAnnouncement,
	}: {
		children?: ReactNode;
		disabled?: boolean;
		onClick?: () => void;
		loading?: boolean;
		loadingAnnouncement?: string;
	} ) => (
		<button type="button" disabled={ disabled } onClick={ onClick }>
			{ loading ? loadingAnnouncement : children }
		</button>
	),
	Tooltip: {
		Root: ( { children }: { children: ReactNode } ) => <>{ children }</>,
		Trigger: ( { render: trigger }: { render: ReactNode } ) => trigger,
		Popup: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
		Positioner: () => null,
	},
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
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
const useDeleteAllSnapshotsMock = vi.mocked( useDeleteAllSnapshots );
const useSnapshotUsageMock = vi.mocked( useSnapshotUsage );
const useSnapshotsMock = vi.mocked( useSnapshots );
const useOfflineMock = vi.mocked( useOffline );
const useStudioAssistantQuotaMock = vi.mocked( useStudioAssistantQuota );
const useUserLocaleMock = vi.mocked( useUserLocale );

const ALPHA_META = 'Free during Alpha';

describe( 'usage sections', () => {
	const deleteSnapshotsMutate = vi.fn();
	const confirmDeleteAllPreviewSites = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();

		confirmDeleteAllPreviewSites.mockResolvedValue( true );
		// `supportsAgenticOptOut` lets the real useAgenticFeatures derive the
		// signed-out/offline reason from the mocked auth + offline hooks.
		useConnectorMock.mockReturnValue( {
			confirmDeleteAllPreviewSites,
			supportsAgenticOptOut: true,
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

	describe( 'AiCreditsSection', () => {
		it( 'falls back to a compact Alpha note when the quota has no cost cap', () => {
			render( <AiCreditsSection /> );

			expect( screen.getByRole( 'heading', { name: 'AI credits' } ) ).toBeInTheDocument();
			expect( screen.getByText( ALPHA_META ) ).toBeInTheDocument();
		} );

		it( 'renders a compact percentage and reset date when a cost cap is available', () => {
			useStudioAssistantQuotaMock.mockReturnValue( {
				data: { costUsage: 25, costCap: 100, costResetDate: '2026-08-01T12:00:00' },
				isLoading: false,
			} as never );

			render( <AiCreditsSection /> );

			expect( screen.getByText( '25%' ) ).toBeInTheDocument();
			expect( screen.getByText( 'Resets Aug 1' ) ).toBeInTheDocument();
			expect( screen.queryByText( ALPHA_META ) ).not.toBeInTheDocument();
		} );

		it( 'shows an unavailable message when the quota fetch fails', () => {
			useStudioAssistantQuotaMock.mockReturnValue( {
				data: undefined,
				isLoading: false,
				isError: true,
			} as never );

			render( <AiCreditsSection /> );

			expect(
				screen.getByText( 'Studio Code limits are temporarily unavailable.' )
			).toBeInTheDocument();
			expect( screen.queryByText( ALPHA_META ) ).not.toBeInTheDocument();
		} );

		it( 'replaces the meter with a hatched placeholder when offline', () => {
			useOfflineMock.mockReturnValue( true );
			useStudioAssistantQuotaMock.mockReturnValue( {
				data: { costUsage: 25, costCap: 100, costResetDate: '2026-08-01T12:00:00' },
				isLoading: false,
			} as never );

			render( <AiCreditsSection /> );

			expect( screen.getByRole( 'img', { name: 'Unavailable' } ) ).toBeInTheDocument();
			expect( screen.queryByText( /of monthly limit used/ ) ).not.toBeInTheDocument();
			expect( screen.queryByTestId( 'usage-progress-bar' ) ).not.toBeInTheDocument();
		} );

		it( 'greys out with a hatched placeholder when signed out', () => {
			useAuthUserMock.mockReturnValue( { data: null, isLoading: false } as never );

			render( <AiCreditsSection /> );

			expect( screen.getByRole( 'img', { name: 'Unavailable' } ) ).toBeInTheDocument();
			expect( screen.queryByText( ALPHA_META ) ).not.toBeInTheDocument();
		} );
	} );

	describe( 'PreviewUsageSection', () => {
		it( 'renders preview site usage for the signed-in user', () => {
			render( <PreviewUsageSection userId={ 1 } /> );

			expect( screen.getByRole( 'heading', { name: 'Preview sites' } ) ).toBeInTheDocument();
			expect( screen.getByText( '2/10' ) ).toBeInTheDocument();
			expect( useSnapshotsMock ).toHaveBeenCalledWith( 1 );
			expect( useSnapshotUsageMock ).toHaveBeenCalledWith( 1 );
			expect( useDeleteAllSnapshotsMock ).toHaveBeenCalledWith( 1 );
		} );

		it( 'confirms through the connector before deleting all preview sites', async () => {
			render( <PreviewUsageSection userId={ 1 } /> );

			fireEvent.click( screen.getByRole( 'button', { name: 'Reset' } ) );

			await waitFor( () => expect( confirmDeleteAllPreviewSites ).toHaveBeenCalledTimes( 1 ) );
			expect( deleteSnapshotsMutate ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'does not delete when the confirmation is declined', async () => {
			confirmDeleteAllPreviewSites.mockResolvedValue( false );

			render( <PreviewUsageSection userId={ 1 } /> );

			fireEvent.click( screen.getByRole( 'button', { name: 'Reset' } ) );

			await waitFor( () => expect( confirmDeleteAllPreviewSites ).toHaveBeenCalledTimes( 1 ) );
			expect( deleteSnapshotsMutate ).not.toHaveBeenCalled();
		} );

		it( 'surfaces a deletion error inline', () => {
			useDeleteAllSnapshotsMock.mockReturnValue( {
				mutate: deleteSnapshotsMutate,
				isPending: false,
				error: new Error( 'delete failed' ),
			} as never );

			render( <PreviewUsageSection userId={ 1 } /> );

			expect(
				screen.getByText( 'An error occurred while deleting preview sites. Please try again.' )
			).toBeInTheDocument();
		} );

		it( 'shows a loading row with an empty progress bar', () => {
			// Preview usage is still cached from before the delete, so the bar would
			// otherwise keep its old fill next to a "Loading..." row.
			useDeleteAllSnapshotsMock.mockReturnValue( {
				mutate: deleteSnapshotsMutate,
				isPending: true,
				error: null,
			} as never );

			render( <PreviewUsageSection userId={ 1 } /> );

			expect( screen.getByText( 'Loading...' ) ).toBeInTheDocument();
			const bar = screen.getByTestId( 'usage-progress-bar' );
			expect( bar.firstElementChild ).toHaveStyle( { inlineSize: '0%' } );
		} );

		it( 'replaces the figures with a hatched placeholder while offline', () => {
			useOfflineMock.mockReturnValue( true );

			render( <PreviewUsageSection userId={ 1 } /> );

			expect( screen.getByRole( 'img', { name: 'Unavailable' } ) ).toBeInTheDocument();
			expect( screen.queryByText( /active preview site/ ) ).not.toBeInTheDocument();
			expect( screen.queryByRole( 'button', { name: 'Reset' } ) ).not.toBeInTheDocument();
		} );
	} );
} );
