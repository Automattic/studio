import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import {
	useArchiveSession,
	useSessions,
	useUnarchiveSession,
	useUpdateSessionMetadata,
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
		params?: { sessionId?: string; siteId?: string };
		className?: string;
		children: ReactNode;
	} ) => {
		const href = params?.sessionId
			? to.replace( '$sessionId', params.sessionId )
			: params?.siteId
			? to.replace( '$siteId', params.siteId )
			: to;
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
	useUpdateSessionMetadata: vi.fn(),
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
const useUpdateSessionMetadataMock = vi.mocked( useUpdateSessionMetadata );
const useUpdateSessionTitleDescriptionMock = vi.mocked( useUpdateSessionTitleDescription );

describe( 'SiteOverviewView', () => {
	const archiveMutate = vi.fn();
	const unarchiveMutate = vi.fn();
	const updateMetadataMutate = vi.fn();
	const updateTitleDescriptionMutateAsync = vi.fn();
	const createSession = vi.fn();
	const continueSession = vi.fn();
	const setSessionModel = vi.fn();
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
		updateMetadataMutate.mockReset();
		updateTitleDescriptionMutateAsync.mockReset().mockResolvedValue( undefined );
		createSession.mockReset().mockResolvedValue( { id: 'new-session' } );
		continueSession.mockReset().mockResolvedValue( { runId: 'run-1' } );
		setSessionModel.mockReset().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			openExternalUrl: vi.fn().mockResolvedValue( undefined ),
			createSession,
			continueSession,
			setSessionModel,
			isFullscreen: vi.fn().mockResolvedValue( false ),
			onFullscreenChange: vi.fn().mockReturnValue( vi.fn() ),
		} as never );
		useArchiveSessionMock.mockReturnValue( { mutate: archiveMutate, isPending: false } as never );
		useUnarchiveSessionMock.mockReturnValue( {
			mutate: unarchiveMutate,
			isPending: false,
		} as never );
		useUpdateSessionMetadataMock.mockReturnValue( {
			mutate: updateMetadataMutate,
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
					description: 'Archived detail should stay hidden',
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

	it( 'lists active chats and keeps archived chats collapsed by default', () => {
		renderOverview();

		expect( screen.getByRole( 'heading', { name: 'Active' } ) ).toBeVisible();
		expect( screen.getByRole( 'link', { name: /Active chat/ } ) ).toHaveAttribute(
			'href',
			'/sessions/active-session'
		);
		expect( screen.getByRole( 'button', { name: 'Archived' } ) ).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		expect( screen.queryByRole( 'link', { name: /Archived chat/ } ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Archived detail should stay hidden' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Other site chat' ) ).not.toBeInTheDocument();
	} );

	it( 'expands archived chats as a compact list', () => {
		renderOverview();

		fireEvent.click( screen.getByRole( 'button', { name: 'Archived' } ) );

		expect( screen.getByRole( 'button', { name: 'Archived' } ) ).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		expect( screen.getByRole( 'link', { name: /Archived chat/ } ) ).toHaveAttribute(
			'href',
			'/sessions/archived-session'
		);
		expect( screen.queryByText( 'Archived detail should stay hidden' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the site details content focused on chats', () => {
		renderOverview();

		expect( screen.queryByRole( 'heading', { name: 'Chats' } ) ).not.toBeInTheDocument();
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

	it( 'archives active chats from the site details view', () => {
		renderOverview();

		fireEvent.click( screen.getByRole( 'button', { name: 'Archive conversation' } ) );
		expect( archiveMutate ).toHaveBeenCalledWith(
			expect.objectContaining( { id: 'active-session' } )
		);
	} );

	it( 'unarchives archived chats from the site details view', () => {
		renderOverview();

		fireEvent.click( screen.getByRole( 'button', { name: 'Archived' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Unarchive conversation' } ) );

		expect( unarchiveMutate ).toHaveBeenCalledWith(
			expect.objectContaining( { id: 'archived-session' } )
		);
	} );

	it( 'stars active chats from the site details view', () => {
		renderOverview();

		fireEvent.click( screen.getByRole( 'button', { name: 'Star conversation' } ) );

		expect( updateMetadataMutate ).toHaveBeenCalledWith( {
			sessionId: 'active-session',
			patch: {
				starred: true,
				archived: false,
			},
		} );
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
			expect( setSessionModel ).not.toHaveBeenCalled();
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

	it( 'uses the selected model when starting a new chat from the fixed composer', async () => {
		renderOverview();

		fireEvent.click( screen.getByRole( 'button', { name: 'Select model' } ) );
		fireEvent.click( await screen.findByRole( 'menuitemradio', { name: 'Opus 4.7' } ) );

		expect( screen.getByRole( 'button', { name: 'Select model' } ) ).toHaveTextContent(
			'Opus 4.7'
		);
		await waitFor( () => {
			expect( screen.queryByRole( 'menuitemradio', { name: 'Opus 4.7' } ) ).not.toBeInTheDocument();
		} );

		fireEvent.change( screen.getByPlaceholderText( /Describe the next change/ ), {
			target: { value: 'Update the homepage heading' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send' } ) );

		await waitFor( () => {
			expect( createSession ).toHaveBeenCalledWith( 'site-1' );
			expect( setSessionModel ).toHaveBeenCalledWith( 'new-session', 'claude-opus-4-7' );
			expect( continueSession ).toHaveBeenCalledWith(
				'new-session',
				'Update the homepage heading',
				{
					displayMessage: 'Update the homepage heading',
				}
			);
		} );
	} );

	it( 'focuses the composer input when clicking the fixed composer shell', () => {
		renderOverview();

		const input = screen.getByPlaceholderText( /Describe the next change/ );
		const shell = input.parentElement;

		expect( shell ).toBeInTheDocument();

		fireEvent.mouseDown( shell as HTMLElement );

		expect( input ).toHaveFocus();
	} );

	it( 'keeps composer toolbar controls from delegating focus to the input', () => {
		renderOverview();

		const input = screen.getByPlaceholderText( /Describe the next change/ );

		for ( const name of [ 'Attach image', 'Skills', 'Select model', 'Send' ] ) {
			fireEvent.mouseDown( screen.getByRole( 'button', { name } ) );

			expect( input ).not.toHaveFocus();
		}
	} );

	it( 'keeps near misses around composer toolbar controls from delegating focus', () => {
		renderOverview();

		const input = screen.getByPlaceholderText( /Describe the next change/ );
		const shell = input.parentElement;
		const attachButton = screen.getByRole( 'button', { name: 'Attach image' } );
		const rectSpy = vi.spyOn( attachButton, 'getBoundingClientRect' ).mockReturnValue( {
			bottom: 32,
			height: 22,
			left: 10,
			right: 32,
			top: 10,
			width: 22,
			x: 10,
			y: 10,
			toJSON: () => ( {} ),
		} );

		expect( shell ).toBeInTheDocument();

		try {
			fireEvent.mouseDown( shell as HTMLElement, { clientX: 36, clientY: 20 } );

			expect( input ).not.toHaveFocus();
		} finally {
			rectSpy.mockRestore();
		}
	} );

	it( 'toggles Explorer from the details view', () => {
		renderOverview();

		expect( screen.getByRole( 'button', { name: 'Show Explorer' } ) ).toHaveAttribute(
			'aria-pressed',
			'false'
		);
		expect( screen.getByText( 'Explorer' ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Show Explorer' } ) );

		expect( screen.getByRole( 'button', { name: 'Hide Explorer' } ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	} );
} );
