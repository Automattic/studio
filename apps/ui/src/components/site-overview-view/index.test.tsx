import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import {
	useArchiveSession,
	useSessions,
	useUnarchiveSession,
	useUpdateSessionTitleDescription,
} from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { SessionUIProvider } from '@/hooks/use-session-ui';
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

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: vi.fn(),
} ) );

vi.mock( '@/components/site-settings-view', () => ( {
	SiteSettingsForm: ( { site }: { site: { name: string } } ) => (
		<div data-testid="site-settings-form">Settings for { site.name }</div>
	),
} ) );

vi.mock( '@/components/site-dropdown', () => ( {
	SiteDropdown: ( { onSettingsClick }: { onSettingsClick?: () => void } ) => (
		<button type="button" onClick={ onSettingsClick }>
			Site menu settings
		</button>
	),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useSitesMock = vi.mocked( useSites );
const useSessionsMock = vi.mocked( useSessions );
const useArchiveSessionMock = vi.mocked( useArchiveSession );
const useUnarchiveSessionMock = vi.mocked( useUnarchiveSession );
const useUpdateSessionTitleDescriptionMock = vi.mocked( useUpdateSessionTitleDescription );

describe( 'SiteOverviewView', () => {
	const archiveMutate = vi.fn();
	const unarchiveMutate = vi.fn();
	const updateTitleDescriptionMutateAsync = vi.fn();
	const createSession = vi.fn();
	const continueSession = vi.fn();
	const renderOverview = () => {
		const queryClient = new QueryClient( {
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		} );
		return render(
			<QueryClientProvider client={ queryClient }>
				<SessionUIProvider>
					<SiteOverviewView siteId="site-1" />
				</SessionUIProvider>
			</QueryClientProvider>
		);
	};

	beforeEach( () => {
		navigateMock.mockReset().mockResolvedValue( undefined );
		archiveMutate.mockReset();
		unarchiveMutate.mockReset();
		updateTitleDescriptionMutateAsync.mockReset().mockResolvedValue( undefined );
		createSession.mockReset().mockResolvedValue( { id: 'new-session' } );
		continueSession.mockReset().mockResolvedValue( { runId: 'run-1' } );
		useConnectorMock.mockReturnValue( {
			openExternalUrl: vi.fn().mockResolvedValue( undefined ),
			createSession,
			continueSession,
			isFullscreen: vi.fn().mockResolvedValue( false ),
			onFullscreenChange: vi.fn().mockReturnValue( vi.fn() ),
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

	it( 'keeps the site details content focused on chats', () => {
		renderOverview();

		expect( screen.getByRole( 'heading', { name: 'Chats' } ) ).toBeVisible();
		expect( screen.queryByRole( 'heading', { name: 'Shortcuts' } ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Local path' ) ).not.toBeInTheDocument();
		expect( screen.queryByTestId( 'site-settings-form' ) ).not.toBeInTheDocument();
	} );

	it( 'opens site settings from the site menu', () => {
		renderOverview();

		fireEvent.click( screen.getByRole( 'button', { name: 'Site menu settings' } ) );

		expect( screen.getByRole( 'heading', { name: 'Site settings' } ) ).toBeVisible();
		expect( screen.getByTestId( 'site-settings-form' ) ).toHaveTextContent(
			'Settings for Example Site'
		);
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

		expect( screen.getByRole( 'button', { name: 'Attach image' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Skills' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Select model' } ) ).toBeInTheDocument();

		fireEvent.change( screen.getByPlaceholderText( /Describe the next change/ ), {
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

	it( 'toggles the browser from the details view', () => {
		renderOverview();

		expect( screen.getByRole( 'button', { name: 'Show browser' } ) ).toHaveAttribute(
			'aria-pressed',
			'false'
		);
		expect( screen.getByText( 'Browser' ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Show browser' } ) );

		expect( screen.getByRole( 'button', { name: 'Hide browser' } ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	} );
} );
