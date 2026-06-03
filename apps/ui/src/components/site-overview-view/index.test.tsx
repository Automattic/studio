import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import {
	useArchiveSession,
	useSessions,
	useUnarchiveSession,
	useUpdateSessionTitleDescription,
} from '@/data/queries/use-sessions';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
} from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { SiteOverviewView } from './index';
import type { ReactNode } from 'react';

const navigateMock = vi.fn();

vi.mock( '@tanstack/react-router', () => ( {
	Link: ( {
		to,
		params,
		className,
		children,
	}: {
		to: string;
		params?: { sessionId?: string };
		className?: string;
		children: ReactNode;
	} ) => {
		const href = params?.sessionId ? to.replace( '$sessionId', params.sessionId ) : to;
		return (
			<a href={ href } className={ className }>
				{ children }
			</a>
		);
	},
	useNavigate: () => navigateMock,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sessions', () => ( {
	SESSIONS_QUERY_KEY: [ 'sessions' ],
	useArchiveSession: vi.fn(),
	useSessions: vi.fn(),
	useUnarchiveSession: vi.fn(),
	useUpdateSessionTitleDescription: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-connected-wpcom-sites', () => ( {
	useConnectedWpcomSites: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
	useSites: vi.fn(),
	useStartSite: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useConnectedWpcomSitesMock = vi.mocked( useConnectedWpcomSites );
const useSitesMock = vi.mocked( useSites );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useStartSiteMock = vi.mocked( useStartSite );
const useUserPreferencesMock = vi.mocked( useUserPreferences );
const useSessionsMock = vi.mocked( useSessions );
const useArchiveSessionMock = vi.mocked( useArchiveSession );
const useUnarchiveSessionMock = vi.mocked( useUnarchiveSession );
const useUpdateSessionTitleDescriptionMock = vi.mocked( useUpdateSessionTitleDescription );

describe( 'SiteOverviewView', () => {
	const archiveMutate = vi.fn();
	const unarchiveMutate = vi.fn();
	const updateTitleDescriptionMutateAsync = vi.fn();
	const openSiteUrl = vi.fn();
	const openSiteFolder = vi.fn();
	const openSiteInEditor = vi.fn();
	const openSiteInTerminal = vi.fn();
	const createSession = vi.fn();
	const continueSession = vi.fn();
	const startSiteMutateAsync = vi.fn();
	const renderOverview = () => {
		const queryClient = new QueryClient( {
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		} );
		return render(
			<QueryClientProvider client={ queryClient }>
				<SiteOverviewView siteId="site-1" />
			</QueryClientProvider>
		);
	};

	beforeEach( () => {
		navigateMock.mockReset().mockResolvedValue( undefined );
		archiveMutate.mockReset();
		unarchiveMutate.mockReset();
		updateTitleDescriptionMutateAsync.mockReset().mockResolvedValue( undefined );
		openSiteUrl.mockReset().mockResolvedValue( undefined );
		openSiteFolder.mockReset().mockResolvedValue( undefined );
		openSiteInEditor.mockReset().mockResolvedValue( undefined );
		openSiteInTerminal.mockReset().mockResolvedValue( undefined );
		createSession.mockReset().mockResolvedValue( { id: 'new-session' } );
		continueSession.mockReset().mockResolvedValue( { runId: 'run-1' } );
		startSiteMutateAsync.mockReset().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			openSiteUrl,
			openSiteFolder,
			openSiteInEditor,
			openSiteInTerminal,
			openExternalUrl: vi.fn().mockResolvedValue( undefined ),
			createSession,
			continueSession,
			isFullscreen: vi.fn().mockResolvedValue( false ),
			onFullscreenChange: vi.fn().mockReturnValue( vi.fn() ),
		} as never );
		useConnectedWpcomSitesMock.mockReturnValue( { data: [] } as never );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
		useStartSiteMock.mockReturnValue( {
			mutateAsync: startSiteMutateAsync,
			isPending: false,
		} as never );
		useUserPreferencesMock.mockReturnValue( {
			data: {
				editor: 'vscode',
				terminal: 'terminal',
				colorScheme: 'system',
				messageSendShortcut: 'mod-enter',
				locale: undefined,
			},
		} as never );
		useArchiveSessionMock.mockReturnValue( { mutate: archiveMutate, isPending: false } as never );
		useUnarchiveSessionMock.mockReturnValue( {
			mutate: unarchiveMutate,
			isPending: false,
		} as never );
		useUpdateSessionTitleDescriptionMock.mockReturnValue( {
			mutateAsync: updateTitleDescriptionMutateAsync,
			isPending: false,
		} as never );
		useSitesMock.mockReturnValue( {
			data: [
				{
					id: 'site-1',
					name: 'Example Site',
					path: '/Users/example/Studio/example-site',
					running: true,
					phpVersion: '8.3',
				},
			],
			isLoading: false,
		} as never );
		useSessionsMock.mockReturnValue( {
			data: [
				{
					id: 'active-session',
					firstPrompt: 'Active chat',
					ownerSitePath: '/Users/example/Studio/example-site',
					updatedAt: '2026-05-01T12:00:00.000Z',
				},
				{
					id: 'archived-session',
					firstPrompt: 'Archived chat',
					ownerSitePath: '/Users/example/Studio/example-site',
					updatedAt: '2026-05-02T12:00:00.000Z',
					archived: true,
				},
				{
					id: 'other-session',
					firstPrompt: 'Other site chat',
					ownerSitePath: '/Users/example/Studio/other-site',
					updatedAt: '2026-05-03T12:00:00.000Z',
				},
			],
			isLoading: false,
		} as never );
	} );

	it( 'lists active and archived chats for the selected site', () => {
		renderOverview();

		expect( screen.getByRole( 'heading', { name: 'Active' } ) ).toBeVisible();
		expect( screen.getByRole( 'link', { name: /Active chat/ } ) ).toHaveAttribute(
			'href',
			'/sessions/active-session'
		);
		expect( screen.getByRole( 'heading', { name: 'Archived' } ) ).toBeVisible();
		expect( screen.getByRole( 'link', { name: /Archived chat/ } ) ).toHaveAttribute(
			'href',
			'/sessions/archived-session'
		);
		expect( screen.queryByText( 'Other site chat' ) ).not.toBeInTheDocument();
	} );

	it( 'opens site shortcuts from the detail view', async () => {
		renderOverview();

		fireEvent.click( screen.getByRole( 'button', { name: /Open site/ } ) );
		await waitFor( () => {
			expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '', { autoLogin: false } );
		} );
		fireEvent.click( screen.getByRole( 'button', { name: /WP Admin/ } ) );
		await waitFor( () => {
			expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/' );
		} );
		fireEvent.click( screen.getByRole( 'button', { name: /Finder|Files|File Explorer/ } ) );
		await waitFor( () => {
			expect( openSiteFolder ).toHaveBeenCalledWith( 'site-1' );
		} );
		fireEvent.click( screen.getByRole( 'button', { name: /Visual Studio Code/ } ) );
		await waitFor( () => {
			expect( openSiteInEditor ).toHaveBeenCalledWith( 'site-1' );
		} );
		fireEvent.click( screen.getByRole( 'button', { name: /Terminal/ } ) );
		await waitFor( () => {
			expect( openSiteInTerminal ).toHaveBeenCalledWith( 'site-1' );
		} );
	} );

	it( 'starts a stopped site before opening web shortcuts', async () => {
		useSitesMock.mockReturnValue( {
			data: [
				{
					id: 'site-1',
					name: 'Example Site',
					path: '/Users/example/Studio/example-site',
					running: false,
					phpVersion: '8.3',
				},
			],
			isLoading: false,
		} as never );

		renderOverview();

		fireEvent.click( screen.getByRole( 'button', { name: /Open site/ } ) );

		await waitFor( () => {
			expect( startSiteMutateAsync ).toHaveBeenCalledWith( 'site-1' );
			expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '', { autoLogin: false } );
		} );
	} );

	it( 'archives and unarchives chats from the site details view', () => {
		renderOverview();

		fireEvent.click( screen.getByRole( 'button', { name: 'Archive' } ) );
		expect( archiveMutate ).toHaveBeenCalledWith(
			expect.objectContaining( { id: 'active-session' } )
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Unarchive' } ) );
		expect( unarchiveMutate ).toHaveBeenCalledWith(
			expect.objectContaining( { id: 'archived-session' } )
		);
	} );

	it( 'edits chat title and description from the site details view', async () => {
		renderOverview();

		fireEvent.click( screen.getAllByRole( 'button', { name: 'Edit' } )[ 0 ] );
		fireEvent.change( screen.getByLabelText( 'Title' ), {
			target: { value: 'Better title' },
		} );
		fireEvent.change( screen.getByLabelText( 'Description' ), {
			target: { value: 'Short useful description' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( updateTitleDescriptionMutateAsync ).toHaveBeenCalledWith( {
			sessionId: 'active-session',
			title: 'Better title',
			description: 'Short useful description',
		} );
	} );

	it( 'keeps unchanged generated chat details as generated metadata', async () => {
		useSessionsMock.mockReturnValue( {
			data: [
				{
					id: 'generated-session',
					firstPrompt: 'Original prompt',
					generatedTitle: 'Generated title',
					generatedDescription: 'Generated description',
					ownerSitePath: '/Users/example/Studio/example-site',
					updatedAt: '2026-05-01T12:00:00.000Z',
				},
			],
			isLoading: false,
		} as never );

		renderOverview();

		fireEvent.click( screen.getByRole( 'button', { name: 'Edit' } ) );
		expect( screen.getByLabelText( 'Title' ) ).toHaveValue( 'Generated title' );
		expect( screen.getByLabelText( 'Description' ) ).toHaveValue( 'Generated description' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( updateTitleDescriptionMutateAsync ).toHaveBeenCalledWith( {
			sessionId: 'generated-session',
			title: undefined,
			description: undefined,
		} );
	} );

	it( 'starts a new chat from the fixed composer', async () => {
		renderOverview();

		fireEvent.change( screen.getByPlaceholderText( /Set your next instruction/ ), {
			target: { value: 'Update the homepage heading' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send' } ) );

		await waitFor( () => {
			expect( createSession ).toHaveBeenCalledWith( 'site-1' );
			expect( continueSession ).toHaveBeenCalledWith(
				'new-session',
				'Update the homepage heading',
				{
					displayMessage: 'Update the homepage heading',
				}
			);
			expect( navigateMock ).toHaveBeenCalledWith( {
				to: '/sessions/$sessionId',
				params: { sessionId: 'new-session' },
			} );
		} );
	} );

	it( 'toggles the site preview from the details header', () => {
		renderOverview();

		expect( screen.getByRole( 'button', { name: 'Show site preview' } ) ).toHaveAttribute(
			'aria-pressed',
			'false'
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Show site preview' } ) );

		expect( screen.getByRole( 'button', { name: 'Hide site preview' } ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	} );
} );
