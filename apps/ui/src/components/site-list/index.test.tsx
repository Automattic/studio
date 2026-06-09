import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { forwardRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIsSessionRunning, useSessionHasPendingQuestion } from '@/data/queries/use-agent-run';
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
let routerParams: { sessionId?: string; siteId?: string };
let routerPathname: string;

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
	useParams: () => routerParams,
	useRouterState: () => routerPathname,
} ) );

vi.mock( '@/data/queries/use-agent-run', () => ( {
	useIsSessionRunning: vi.fn(),
	useSessionHasPendingQuestion: vi.fn(),
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
const useSessionHasPendingQuestionMock = vi.mocked( useSessionHasPendingQuestion );
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
	const startSiteMutate = vi.fn();
	const stopSiteMutate = vi.fn();

	beforeEach( () => {
		navigateMock.mockReset();
		routerParams = { siteId: 'site-1' };
		routerPathname = '/sites/site-1';
		updateTitleDescriptionMutateAsync.mockReset().mockResolvedValue( undefined );
		startSiteMutate.mockReset();
		stopSiteMutate.mockReset();
		useIsSessionRunningMock.mockReset().mockReturnValue( false );
		useSessionHasPendingQuestionMock.mockReset().mockReturnValue( false );
		useUpdateSessionMetadataMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useArchiveSessionMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useUnarchiveSessionMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useUpdateSessionTitleDescriptionMock.mockReturnValue( {
			mutateAsync: updateTitleDescriptionMutateAsync,
			isPending: false,
		} as never );
		useStartSiteMock.mockReturnValue( { mutate: startSiteMutate, isPending: false } as never );
		useStopSiteMock.mockReturnValue( { mutate: stopSiteMutate, isPending: false } as never );
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

	afterEach( () => {
		vi.useRealTimers();
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

	it( 'shows an empty chat state for open sites without active chats', () => {
		useSessionsMock.mockReturnValue( { data: [], isLoading: false } as never );

		render( <SiteList /> );

		const emptyState = screen.getByText( 'No active chats' ).parentElement!;

		expect( within( emptyState ).getByRole( 'button', { name: 'New chat' } ) ).toBeInTheDocument();
	} );

	it( 'shows unassigned chats when they are active', () => {
		useSessionsMock.mockReturnValue( {
			data: [
				{
					id: 'unassigned-session',
					title: 'Loose chat',
					generatedTitle: 'Loose chat',
					firstPrompt: 'Review this idea',
					updatedAt: '2026-05-02T12:00:00.000Z',
				},
			],
			isLoading: false,
		} as never );

		render( <SiteList /> );

		expect( screen.getByText( 'Unassigned' ) ).toBeInTheDocument();
	} );

	it( 'hides the unassigned group when there are no active unassigned chats', () => {
		useSessionsMock.mockReturnValue( {
			data: [
				{
					id: 'archived-unassigned-session',
					title: 'Archived loose chat',
					generatedTitle: 'Archived loose chat',
					firstPrompt: 'Archive me',
					updatedAt: '2026-05-02T12:00:00.000Z',
					archived: true,
				},
			],
			isLoading: false,
		} as never );

		render( <SiteList /> );

		expect( screen.queryByText( 'Unassigned' ) ).not.toBeInTheDocument();
	} );

	it( 'shows site status buttons for running and stopped sites', () => {
		useSitesMock.mockReturnValue( {
			data: [
				{
					id: 'site-1',
					name: 'Running Site',
					path: '/Users/example/Studio/running-site',
					running: true,
				},
				{
					id: 'site-2',
					name: 'Stopped Site',
					path: '/Users/example/Studio/stopped-site',
					running: false,
				},
			],
			isLoading: false,
		} as never );
		useSessionsMock.mockReturnValue( { data: [], isLoading: false } as never );

		render( <SiteList /> );

		expect(
			screen.getByRole( 'button', { name: 'Site status: Running. Stop site' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Site status: Stopped. Start site' } )
		).toBeInTheDocument();
	} );

	it( 'orders site row actions before the status button', () => {
		useSessionsMock.mockReturnValue( { data: [], isLoading: false } as never );

		render( <SiteList /> );

		const siteActions = screen.getByRole( 'button', { name: 'Site actions' } );
		const newChat = screen.getAllByRole( 'button', { name: 'New chat' } )[ 0 ];
		const status = screen.getByRole( 'button', { name: 'Site status: Running. Stop site' } );

		expect(
			siteActions.compareDocumentPosition( newChat ) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(
			newChat.compareDocumentPosition( status ) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	} );

	it( 'starts and stops sites from the site status buttons', () => {
		useSitesMock.mockReturnValue( {
			data: [
				{
					id: 'site-1',
					name: 'Running Site',
					path: '/Users/example/Studio/running-site',
					running: true,
				},
				{
					id: 'site-2',
					name: 'Stopped Site',
					path: '/Users/example/Studio/stopped-site',
					running: false,
				},
			],
			isLoading: false,
		} as never );
		useSessionsMock.mockReturnValue( { data: [], isLoading: false } as never );

		render( <SiteList /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Site status: Running. Stop site' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Site status: Stopped. Start site' } ) );

		expect( stopSiteMutate ).toHaveBeenCalledWith( 'site-1' );
		expect( startSiteMutate ).toHaveBeenCalledWith( 'site-2' );
	} );

	it( 'shows a transitioning site status while a site is starting', () => {
		useSitesMock.mockReturnValue( {
			data: [
				{
					id: 'site-1',
					name: 'Starting Site',
					path: '/Users/example/Studio/starting-site',
					running: false,
				},
			],
			isLoading: false,
		} as never );
		useSessionsMock.mockReturnValue( { data: [], isLoading: false } as never );
		useIsSiteStartingMock.mockReturnValue( true );

		render( <SiteList /> );

		expect( screen.getByRole( 'button', { name: 'Site status: Starting' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
	} );

	it( 'does not open the first site by default on settings', () => {
		routerParams = {};
		routerPathname = '/settings';

		render( <SiteList /> );

		expect( screen.queryByText( 'Generated title' ) ).not.toBeInTheDocument();
		expect( useIsSessionRunningMock ).not.toHaveBeenCalled();
		expect( useSessionHasPendingQuestionMock ).not.toHaveBeenCalled();
	} );

	it( 'mounts chat rows when a closed site is expanded', () => {
		routerParams = {};
		routerPathname = '/settings';

		render( <SiteList /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Show chats' } ) );

		expect( screen.getByText( 'Generated title' ) ).toBeInTheDocument();
		expect( useIsSessionRunningMock ).toHaveBeenCalledWith( 'session-1' );
		expect( useSessionHasPendingQuestionMock ).toHaveBeenCalledWith( 'session-1' );
	} );

	it( 'keeps the timestamp visible when a chat is running', () => {
		vi.useFakeTimers();
		vi.setSystemTime( new Date( '2026-05-03T12:00:00.000Z' ) );
		useIsSessionRunningMock.mockReturnValue( true );

		render( <SiteList /> );

		expect( screen.getByRole( 'status', { name: 'Working…' } ) ).toBeInTheDocument();
		expect( screen.getByText( '2d' ) ).toBeInTheDocument();
	} );

	it( 'shows a question indicator instead of the running spinner when a chat needs an answer', () => {
		useIsSessionRunningMock.mockReturnValue( true );
		useSessionHasPendingQuestionMock.mockReturnValue( true );

		render( <SiteList /> );

		expect( screen.getByRole( 'status', { name: 'Studio needs an answer.' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'status', { name: 'Working…' } ) ).not.toBeInTheDocument();
	} );
} );
