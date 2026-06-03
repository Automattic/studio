import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { forwardRef, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useIsSessionRunning } from '@/data/queries/use-agent-run';
import {
	useArchiveSession,
	useSessions,
	useUnarchiveSession,
	useUpdateSessionMetadata,
	useUpdateSessionTitleDescription,
} from '@/data/queries/use-sessions';
import {
	useCopySite,
	useDeleteSite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { SiteList } from './index';

const navigateMock = vi.fn();

vi.mock( '@tanstack/react-router', () => ( {
	Link: forwardRef<
		HTMLAnchorElement,
		{
			to: string;
			params?: { sessionId?: string; siteId?: string };
			className?: string;
			activeProps?: { className?: string };
			tabIndex?: number;
			children: ReactNode;
		}
	>( function MockLink( { to, params, className, activeProps, tabIndex, children }, ref ) {
		const href = params?.sessionId
			? to.replace( '$sessionId', params.sessionId )
			: params?.siteId
			? to.replace( '$siteId', params.siteId )
			: to;
		return (
			<a
				ref={ ref }
				href={ href }
				className={ activeProps?.className ?? className }
				tabIndex={ tabIndex }
			>
				{ children }
			</a>
		);
	} ),
	useNavigate: () => navigateMock,
	useParams: () => ( {} ),
	useRouterState: () => '/',
} ) );

vi.mock( '@/data/queries/use-agent-run', () => ( {
	useIsSessionRunning: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sessions', () => ( {
	useArchiveSession: vi.fn(),
	useSessions: vi.fn(),
	useUnarchiveSession: vi.fn(),
	useUpdateSessionMetadata: vi.fn(),
	useUpdateSessionTitleDescription: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useCopySite: vi.fn(),
	useDeleteSite: vi.fn(),
	useExportDatabase: vi.fn(),
	useExportFullSite: vi.fn(),
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
	useSites: vi.fn(),
	useStartSite: vi.fn(),
	useStopSite: vi.fn(),
} ) );

const useIsSessionRunningMock = vi.mocked( useIsSessionRunning );
const useSessionsMock = vi.mocked( useSessions );
const useArchiveSessionMock = vi.mocked( useArchiveSession );
const useUnarchiveSessionMock = vi.mocked( useUnarchiveSession );
const useUpdateSessionMetadataMock = vi.mocked( useUpdateSessionMetadata );
const useUpdateSessionTitleDescriptionMock = vi.mocked( useUpdateSessionTitleDescription );
const useSitesMock = vi.mocked( useSites );
const useStartSiteMock = vi.mocked( useStartSite );
const useStopSiteMock = vi.mocked( useStopSite );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useCopySiteMock = vi.mocked( useCopySite );
const useExportDatabaseMock = vi.mocked( useExportDatabase );
const useExportFullSiteMock = vi.mocked( useExportFullSite );
const useDeleteSiteMock = vi.mocked( useDeleteSite );

describe( 'SiteList', () => {
	const updateTitleDescriptionMutateAsync = vi.fn();

	beforeEach( () => {
		navigateMock.mockReset();
		updateTitleDescriptionMutateAsync.mockReset().mockResolvedValue( undefined );
		useIsSessionRunningMock.mockReturnValue( false );
		useUpdateSessionMetadataMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useArchiveSessionMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useUnarchiveSessionMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useUpdateSessionTitleDescriptionMock.mockReturnValue( {
			mutateAsync: updateTitleDescriptionMutateAsync,
			isPending: false,
		} as never );
		useStartSiteMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useStopSiteMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
		useCopySiteMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useExportDatabaseMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useExportFullSiteMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useDeleteSiteMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useSitesMock.mockReturnValue( {
			data: [
				{
					id: 'site-1',
					name: 'Example Site',
					path: '/Users/example/Studio/example-site',
					running: true,
				},
			],
			isLoading: false,
		} as never );
		useSessionsMock.mockReturnValue( {
			data: [
				{
					id: 'session-1',
					title: 'Generated title',
					generatedTitle: 'Generated title',
					firstPrompt: 'Build a landing page',
					ownerSitePath: '/Users/example/Studio/example-site',
					updatedAt: '2026-05-01T12:00:00.000Z',
				},
			],
			isLoading: false,
		} as never );
	} );

	it( 'edits a chat title in place from the sidebar', async () => {
		render( <SiteList /> );

		fireEvent.doubleClick( screen.getByText( 'Generated title' ) );
		const input = screen.getByRole( 'textbox', { name: 'Chat title' } );
		expect( input ).toHaveValue( 'Generated title' );

		fireEvent.change( input, { target: { value: 'Better sidebar title' } } );
		fireEvent.submit( input.closest( 'form' )! );

		expect( updateTitleDescriptionMutateAsync ).toHaveBeenCalledWith( {
			sessionId: 'session-1',
			title: 'Better sidebar title',
		} );
	} );

	it( 'does not save an unchanged generated sidebar title as a user override', async () => {
		render( <SiteList /> );

		fireEvent.doubleClick( screen.getByText( 'Generated title' ) );
		fireEvent.submit( screen.getByRole( 'textbox', { name: 'Chat title' } ).closest( 'form' )! );

		expect( updateTitleDescriptionMutateAsync ).toHaveBeenCalledWith( {
			sessionId: 'session-1',
			title: undefined,
		} );
	} );
} );
