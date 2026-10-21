import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useSiteAgentActivity } from '@/data/queries/use-agent-run';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useSessions } from '@/data/queries/use-sessions';
import {
	useCopySite,
	useDeleteSite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteBusy,
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
	useStopSite,
	useUpdateSitesSortOrder,
} from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { SiteList } from './index';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

const navigateMock = vi.fn();
const OPEN_IN_FILE_MANAGER = /^Open in (Finder|File Explorer|File manager)$/;
let paramsMock: { sessionId?: string; siteId?: string } = {};
let pathnameMock = '/';

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigateMock,
	useParams: () => paramsMock,
	useRouterState: ( options?: {
		select?: ( state: { location: { pathname: string } } ) => unknown;
	} ) => {
		const state = { location: { pathname: pathnameMock } };
		return options?.select ? options.select( state ) : state;
	},
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

const archiveSession = vi.hoisted( () => vi.fn() );

vi.mock( '@/data/queries/use-sessions', () => ( {
	useSessions: vi.fn(),
	useUpdateSessionMetadata: () => ( { mutateAsync: archiveSession } ),
} ) );

let pinsMock: string[] = [];
const togglePin = vi.hoisted( () => vi.fn() );

vi.mock( '@/data/queries/use-sidebar-pins', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	useSidebarPins: () => ( {
		pins: pinsMock,
		setPins: vi.fn(),
		isPinned: ( key: string ) => pinsMock.includes( key ),
		togglePin,
	} ),
} ) );

vi.mock( '@/data/queries/use-agent-run', () => ( {
	useSiteAgentActivity: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	COPY_SITE_MUTATION_KEY: [ 'copySite' ],
	EXPORT_DATABASE_MUTATION_KEY: [ 'exportDatabase' ],
	EXPORT_FULL_SITE_MUTATION_KEY: [ 'exportFullSite' ],
	useCopySite: vi.fn(),
	useDeleteSite: vi.fn(),
	useExportDatabase: vi.fn(),
	useExportFullSite: vi.fn(),
	useIsSiteBusy: vi.fn(),
	useIsSiteMutating: vi.fn(),
	useSiteOperation: vi.fn(),
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
	useSites: vi.fn(),
	useStartSite: vi.fn(),
	useStopSite: vi.fn(),
	useUpdateSitesSortOrder: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-agentic-features', () => ( {
	useAgenticFeatures: vi.fn( () => ( {
		enabled: true,
		chatEnabled: true,
		chatPromptsSignIn: false,
		reason: null,
		isReady: true,
	} ) ),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@/data/sync-activity', () => ( {
	useSiteSyncActivity: vi.fn(),
} ) );

vi.mock( '@/components/import-site-dialog', () => ( {
	IMPORT_FILE_ACCEPT: '',
	ImportSiteDialog: () => null,
	useSiteBackupImport: () => ( {} ),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useCopySiteMock = vi.mocked( useCopySite, { partial: true } );
const useDeleteSiteMock = vi.mocked( useDeleteSite, { partial: true } );
const useExportDatabaseMock = vi.mocked( useExportDatabase, { partial: true } );
const useExportFullSiteMock = vi.mocked( useExportFullSite, { partial: true } );
const useIsSiteBusyMock = vi.mocked( useIsSiteBusy );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useSiteAgentActivityMock = vi.mocked( useSiteAgentActivity );
const useSessionsMock = vi.mocked( useSessions, { partial: true } );
const useSitesMock = vi.mocked( useSites, { partial: true } );
const useStartSiteMock = vi.mocked( useStartSite, { partial: true } );
const useStopSiteMock = vi.mocked( useStopSite, { partial: true } );
const useUpdateSitesSortOrderMock = vi.mocked( useUpdateSitesSortOrder, { partial: true } );
const useSiteSyncActivityMock = vi.mocked( useSiteSyncActivity );
const useUserPreferencesMock = vi.mocked( useUserPreferences, { partial: true } );
describe( 'SiteList', () => {
	const startSite = vi.fn();
	const stopSite = vi.fn();
	const updateSitesSortOrder = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		pinsMock = [];
		paramsMock = {};
		pathnameMock = '/';

		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: true,
			chatEnabled: true,
			chatPromptsSignIn: false,
			reason: null,
			isReady: true,
		} );
		useIsSiteBusyMock.mockReturnValue( false );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
		useSiteAgentActivityMock.mockReturnValue( 'idle' );
		useSiteSyncActivityMock.mockReturnValue( null );
		useSessionsMock.mockReturnValue( { data: [], isLoading: false } );
		useConnectorMock.mockReturnValue( {
			openExternalUrl: vi.fn().mockResolvedValue( undefined ),
			openSiteUrl: vi.fn().mockResolvedValue( undefined ),
			openSiteFolder: vi.fn().mockResolvedValue( undefined ),
			openSiteInEditor: vi.fn().mockResolvedValue( undefined ),
			openSiteInTerminal: vi.fn().mockResolvedValue( undefined ),
			trackEvent: vi.fn().mockResolvedValue( undefined ),
		} as unknown as ReturnType< typeof useConnector > );
		useCopySiteMock.mockReturnValue( { isPending: false, mutate: vi.fn() } );
		useDeleteSiteMock.mockReturnValue( { isPending: false, mutate: vi.fn() } );
		useExportDatabaseMock.mockReturnValue( { isPending: false, mutate: vi.fn() } );
		useExportFullSiteMock.mockReturnValue( { isPending: false, mutate: vi.fn() } );
		useStartSiteMock.mockReturnValue( { isPending: false, mutate: startSite } );
		useStopSiteMock.mockReturnValue( { isPending: false, mutate: stopSite } );
		useUpdateSitesSortOrderMock.mockReturnValue( {
			isPending: false,
			mutate: updateSitesSortOrder,
		} );
		useUserPreferencesMock.mockReturnValue( {
			data: {
				editor: 'vscode',
				terminal: null,
				colorScheme: 'system',
				locale: 'en',
				analyticsEnabled: true,
				defaultSiteDirectory: '',
				studioCliInstalled: false,
				studioCliExternallyManaged: false,
				agenticFeaturesEnabled: true,
			},
		} );
		useSitesMock.mockReturnValue( {
			data: [
				createSite( {
					id: 'stopped-site',
					name: 'Stopped Site',
					path: '/Users/example/Studio/stopped-site',
					running: false,
					sortOrder: 1000,
				} ),
				createSite( {
					id: 'running-site',
					name: 'Running Site',
					path: '/Users/example/Studio/running-site',
					running: true,
					sortOrder: 2000,
				} ),
			],
			isLoading: false,
		} );
	} );

	it( 'starts a stopped site and stops a running one from its row', () => {
		render( <SiteList /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Start Stopped Site' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Stop Running Site' } ) );

		expect( startSite ).toHaveBeenCalledWith( 'stopped-site' );
		expect( stopSite ).toHaveBeenCalledWith( 'running-site' );
		expect( navigateMock ).not.toHaveBeenCalled();
	} );

	it( 'opens a new chat for a site from its row', () => {
		const onSiteOpen = vi.fn();
		render( <SiteList onSiteOpen={ onSiteOpen } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'New chat for Stopped Site' } ) );

		expect( onSiteOpen ).toHaveBeenCalledTimes( 1 );
		expect( navigateMock ).toHaveBeenLastCalledWith( {
			to: '/sites/$siteId/new',
			params: { siteId: 'stopped-site' },
		} );
	} );

	it( 'opens site actions from a row right-click without opening the latest chat', async () => {
		render( <SiteList /> );

		fireEvent.contextMenu( screen.getByText( 'Stopped Site' ) );

		expect( navigateMock ).not.toHaveBeenCalled();
		expect( await screen.findByText( 'Site settings' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Duplicate site' ) ).toBeInTheDocument();
		expect( screen.getByText( OPEN_IN_FILE_MANAGER ) ).toBeInTheDocument();
		expect( screen.getByText( 'Export entire site' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Delete site' ) ).toBeInTheDocument();
	} );

	it( 'opens the site folder through the connector and records a Tracks event', async () => {
		render( <SiteList /> );

		fireEvent.contextMenu( screen.getByText( 'Stopped Site' ) );
		fireEvent.click( await screen.findByText( OPEN_IN_FILE_MANAGER ) );

		expect( useConnectorMock().openSiteFolder ).toHaveBeenCalledWith( 'stopped-site' );
		expect( useConnectorMock().trackEvent ).toHaveBeenCalledWith( 'studio_site_open_folder' );
	} );

	it( 'opens phpMyAdmin and WP Admin through the host so the session is kept', async () => {
		render( <SiteList /> );

		fireEvent.contextMenu( screen.getByText( 'Running Site' ) );
		fireEvent.click( await screen.findByText( 'Open in phpMyAdmin' ) );

		fireEvent.contextMenu( screen.getByText( 'Running Site' ) );
		fireEvent.click( await screen.findByText( 'Open in Browser (WP Admin)' ) );

		expect( useConnectorMock().openSiteUrl ).toHaveBeenCalledWith(
			'running-site',
			'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
		);
		expect( useConnectorMock().openSiteUrl ).toHaveBeenCalledWith( 'running-site', '/wp-admin/' );
		expect( useConnectorMock().openExternalUrl ).not.toHaveBeenCalled();
		expect( useConnectorMock().trackEvent ).toHaveBeenCalledWith( 'studio_site_open_phpmyadmin', {
			browser: 'external',
		} );
		expect( useConnectorMock().trackEvent ).toHaveBeenCalledWith( 'studio_site_open_wp_admin', {
			browser: 'external',
		} );
	} );

	it( 'disables the browser-only destinations while the site is stopped', async () => {
		render( <SiteList /> );

		fireEvent.contextMenu( screen.getByText( 'Stopped Site' ) );

		expect( await screen.findByText( 'Open in Browser' ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getByText( 'Open in phpMyAdmin' ) ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( screen.getByText( 'Open in Browser (WP Admin)' ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getByText( OPEN_IN_FILE_MANAGER ) ).not.toHaveAttribute( 'aria-disabled' );
	} );

	it( 'opens site settings from the site actions menu', async () => {
		const onSiteOpen = vi.fn();
		render( <SiteList onSiteOpen={ onSiteOpen } /> );

		fireEvent.contextMenu( screen.getByText( 'Stopped Site' ) );
		fireEvent.click( await screen.findByText( 'Site settings' ) );

		expect( onSiteOpen ).toHaveBeenCalledTimes( 1 );
		expect( navigateMock ).toHaveBeenCalledTimes( 1 );
		expect( navigateMock ).toHaveBeenLastCalledWith( {
			to: '/sites/$siteId/settings',
			params: { siteId: 'stopped-site' },
		} );
		expect( useConnectorMock().trackEvent ).toHaveBeenCalledWith( 'studio_panel_opened', {
			panel: 'settings',
		} );
	} );

	it( 'opens the Studio Code sign-in screen when clicking a site while signed out', () => {
		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: false,
			chatEnabled: false,
			chatPromptsSignIn: true,
			reason: 'signed-out',
			isReady: true,
		} );

		render( <SiteList /> );

		fireEvent.click( screen.getByText( 'Stopped Site' ) );

		expect( navigateMock ).toHaveBeenCalledTimes( 1 );
		expect( navigateMock ).toHaveBeenLastCalledWith( {
			to: '/sites/$siteId/new',
			params: { siteId: 'stopped-site' },
		} );
		expect( useConnectorMock().trackEvent ).toHaveBeenCalledWith( 'studio_panel_opened', {
			panel: 'assistant',
		} );
	} );

	it( 'records an assistant panel event when clicking a site name opens chat', () => {
		render( <SiteList /> );

		fireEvent.click( screen.getByText( 'Stopped Site' ) );

		expect( useConnectorMock().trackEvent ).toHaveBeenCalledWith( 'studio_panel_opened', {
			panel: 'assistant',
		} );
	} );

	it( 'shows the selected chat when signed out', () => {
		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: false,
			chatEnabled: false,
			chatPromptsSignIn: true,
			reason: 'signed-out',
			isReady: true,
		} );
		paramsMock = { siteId: 'stopped-site' };
		pathnameMock = '/sites/stopped-site/new';

		render( <SiteList /> );

		const stoppedRow = screen.getByText( 'Stopped Site' ).closest( 'section' )!;
		const className = stoppedRow.getAttribute( 'class' ) ?? '';
		const siteButton = within( stoppedRow ).getByRole( 'button', { name: 'Stopped Site' } );

		expect( className ).toContain( 'siteActive' );
		expect( className ).not.toContain( 'siteContextActive' );
		expect( siteButton ).toHaveAttribute( 'aria-current', 'page' );
	} );

	it( "opens the site's page when Studio Code is switched off", () => {
		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: true,
			chatEnabled: false,
			chatPromptsSignIn: false,
			reason: null,
			isReady: true,
		} );

		render( <SiteList /> );

		fireEvent.click( screen.getByText( 'Stopped Site' ) );

		expect( navigateMock ).toHaveBeenLastCalledWith( {
			to: '/sites/$siteId',
			params: { siteId: 'stopped-site' },
		} );
	} );

	it( 'shows the Xdebug glyph in place of the site icon', () => {
		useSitesMock.mockReturnValue( {
			data: [
				createSite( {
					id: 'xdebug-site',
					name: 'Xdebug Site',
					path: '/Users/example/Studio/xdebug-site',
					running: false,
					enableXdebug: true,
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList /> );

		const row = screen.getByText( 'Xdebug Site' ).closest( 'section' )!;
		expect( within( row ).getByLabelText( 'Xdebug enabled' ) ).toBeInTheDocument();
	} );

	it( 'marks the site row as current for the active chat', () => {
		paramsMock = { sessionId: 'stopped-chat' };
		pathnameMock = '/sessions/stopped-chat';
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'stopped-chat',
					ownerSitePath: '/Users/example/Studio/stopped-site',
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList /> );

		const stoppedRow = screen.getByText( 'Stopped Site' ).closest( 'section' )!;
		const siteButton = within( stoppedRow ).getByRole( 'button', { name: 'Stopped Site' } );

		expect( siteButton ).toHaveAttribute( 'aria-current', 'page' );
	} );

	it( "groups sites with the open site's chats, and lists recent chats", async () => {
		paramsMock = { sessionId: 'site-chat' };
		pathnameMock = '/sessions/site-chat';
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'site-chat',
					firstPrompt: 'Add a menu',
					ownerSitePath: '/Users/example/Studio/stopped-site',
				} ),
				createSession( {
					id: 'other-chat',
					firstPrompt: 'Make it blue',
					ownerSitePath: '/Users/example/Studio/running-site',
				} ),
				createSession( {
					id: 'archived-chat',
					firstPrompt: 'Old idea',
					ownerSitePath: '/Users/example/Studio/stopped-site',
					archived: true,
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList sections /> );

		const sites = screen.getByRole( 'group', { name: 'Sites' } );
		const openSite = within( sites ).getByText( 'Stopped Site' ).closest( 'section' )!;
		expect( within( openSite ).getByRole( 'button', { name: 'Add a menu' } ) ).toHaveAttribute(
			'aria-current',
			'page'
		);
		expect( within( sites ).queryByText( 'Make it blue' ) ).not.toBeInTheDocument();
		const recent = screen.getByRole( 'group', { name: 'Recent' } );
		expect( within( recent ).getByRole( 'button', { name: 'Make it blue' } ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Old idea' ) ).not.toBeInTheDocument();

		fireEvent.click( within( openSite ).getByRole( 'button', { name: 'Archive chat' } ) );
		await waitFor( () => expect( navigateMock ).toHaveBeenLastCalledWith( { to: '/' } ) );
		expect( archiveSession ).toHaveBeenCalledWith( {
			sessionId: 'site-chat',
			patch: { archived: true },
		} );

		fireEvent.contextMenu( within( recent ).getByText( 'Make it blue' ) );
		fireEvent.keyDown( await screen.findByRole( 'menu' ), {
			key: 'A',
			ctrlKey: true,
			shiftKey: true,
		} );
		expect( archiveSession ).toHaveBeenLastCalledWith( {
			sessionId: 'other-chat',
			patch: { archived: true },
		} );
	} );

	it( 'moves pinned sites and chats into the Pinned group, in pin order', async () => {
		pinsMock = [ 'chat:other-chat', 'site:stopped-site' ];
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'other-chat',
					firstPrompt: 'Make it blue',
					ownerSitePath: '/Users/example/Studio/running-site',
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList sections /> );

		const pinned = screen.getByRole( 'group', { name: 'Pinned' } );
		expect(
			within( pinned )
				.getAllByText( /^(Make it blue|Stopped Site)$/ )
				.map( ( element ) => element.textContent )
		).toEqual( [ 'Make it blue', 'Stopped Site' ] );
		const sites = screen.getByRole( 'group', { name: 'Sites' } );
		expect( within( sites ).queryByText( 'Stopped Site' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'group', { name: 'Recent' } ) ).not.toBeInTheDocument();

		fireEvent.click( within( pinned ).getByRole( 'button', { name: 'Unpin chat' } ) );
		expect( togglePin ).toHaveBeenCalledWith( 'chat:other-chat' );

		fireEvent.contextMenu( within( sites ).getByText( 'Running Site' ) );
		fireEvent.keyDown( await screen.findByRole( 'menu' ), {
			key: 'p',
			keyCode: 80,
			ctrlKey: true,
			altKey: true,
		} );
		expect( togglePin ).toHaveBeenLastCalledWith( 'site:running-site' );
	} );

	it( 'marks the site row as contextual on the site settings route', () => {
		paramsMock = { siteId: 'stopped-site' };
		pathnameMock = '/sites/stopped-site/settings';

		render( <SiteList /> );

		const stoppedRow = screen.getByText( 'Stopped Site' ).closest( 'section' )!;
		const siteButton = within( stoppedRow ).getByRole( 'button', { name: 'Stopped Site' } );

		expect( siteButton ).not.toHaveAttribute( 'aria-current' );
		expect( stoppedRow.getAttribute( 'class' ) ?? '' ).toContain( 'siteContextActive' );
	} );

	it( 'opens the latest active chat when a site is clicked', () => {
		const onSiteOpen = vi.fn();
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'older-chat',
					firstPrompt: 'Older visible chat',
					ownerSitePath: '/Users/example/Studio/stopped-site',
					updatedAt: '2026-06-01T12:00:00.000Z',
				} ),
				createSession( {
					id: 'latest-chat',
					firstPrompt: 'Latest visible chat',
					ownerSitePath: '/Users/example/Studio/stopped-site',
					updatedAt: '2026-06-20T12:00:00.000Z',
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList onSiteOpen={ onSiteOpen } /> );

		expect( screen.queryByText( 'Latest visible chat' ) ).not.toBeInTheDocument();

		const stoppedRow = screen.getByText( 'Stopped Site' ).closest( 'header' );
		expect( stoppedRow ).toBeInTheDocument();

		fireEvent.click( stoppedRow! );

		expect( navigateMock ).toHaveBeenCalledWith( {
			to: '/sessions/$sessionId',
			params: { sessionId: 'latest-chat' },
		} );
		expect( onSiteOpen ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'keeps the site list order instead of sorting by recent chat activity', () => {
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'older-stopped-chat',
					ownerSitePath: '/Users/example/Studio/stopped-site',
					updatedAt: '2026-06-01T12:00:00.000Z',
				} ),
				createSession( {
					id: 'newer-running-chat',
					ownerSitePath: '/Users/example/Studio/running-site',
					updatedAt: '2026-06-20T12:00:00.000Z',
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList /> );

		const stoppedSite = screen.getByText( 'Stopped Site' );
		const runningSite = screen.getByText( 'Running Site' );

		expect(
			stoppedSite.compareDocumentPosition( runningSite ) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBe( Node.DOCUMENT_POSITION_FOLLOWING );
	} );

	it( 'matches sessions by owner site id, falling back to path for legacy sessions', () => {
		useSitesMock.mockReturnValue( {
			data: [
				createSite( { id: 'site-a', name: 'Site A', path: '/sites/site-a' } ),
				createSite( { id: 'site-b', name: 'Site B', path: '/sites/site-b' } ),
			],
			isLoading: false,
		} );
		useSessionsMock.mockReturnValue( {
			data: [
				// A stale path must lose to the site id.
				createSession( {
					id: 'by-id',
					ownerSiteId: 'site-b',
					ownerSitePath: '/sites/site-a',
					updatedAt: '2026-06-20T12:00:00.000Z',
				} ),
				createSession( {
					id: 'legacy',
					ownerSitePath: '/sites/site-a',
					updatedAt: '2026-06-10T12:00:00.000Z',
				} ),
				// A deleted site's id must not fall back to a path that now
				// belongs to another site.
				createSession( {
					id: 'orphan',
					ownerSiteId: 'deleted-site',
					ownerSitePath: '/sites/site-a',
					updatedAt: '2026-06-25T12:00:00.000Z',
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Site B' } ) );
		expect( navigateMock ).toHaveBeenLastCalledWith( {
			to: '/sessions/$sessionId',
			params: { sessionId: 'by-id' },
		} );

		// The orphan is newer but must not attach to Site A via its stale path.
		fireEvent.click( screen.getByRole( 'button', { name: 'Site A' } ) );
		expect( navigateMock ).toHaveBeenLastCalledWith( {
			to: '/sessions/$sessionId',
			params: { sessionId: 'legacy' },
		} );
	} );

	it( 'persists a manual site order after drag and drop', () => {
		render( <SiteList /> );

		const stoppedRow = document.querySelector( '[data-reorder-id="stopped-site"]' );
		const runningRow = document.querySelector( '[data-reorder-id="running-site"]' );

		expect( stoppedRow ).toBeInTheDocument();
		expect( runningRow ).toBeInTheDocument();
		vi.spyOn( stoppedRow!, 'getBoundingClientRect' ).mockReturnValue(
			createRect( { top: 0, left: 8, width: 272, height: 34 } )
		);
		vi.spyOn( runningRow!, 'getBoundingClientRect' ).mockReturnValue(
			createRect( { top: 35, left: 0, width: 0, height: 34 } )
		);

		fireEvent(
			stoppedRow!,
			createPointerEvent( 'pointerdown', { button: 0, clientX: 16, clientY: 10 } )
		);
		fireEvent( window, createPointerEvent( 'pointermove', { clientX: 16, clientY: 70 } ) );

		expect( screen.getByTestId( 'drop-placeholder' ) ).toBeInTheDocument();
		expect( document.querySelector( '[data-reorder-id="stopped-site"]' ) ).not.toBeInTheDocument();
		expect( updateSitesSortOrder ).not.toHaveBeenCalled();

		fireEvent( window, createPointerEvent( 'pointerup', { clientX: 16, clientY: 70 } ) );

		const stoppedSite = screen.getByText( 'Stopped Site' );
		const runningSite = screen.getByText( 'Running Site' );

		expect(
			runningSite.compareDocumentPosition( stoppedSite ) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBe( Node.DOCUMENT_POSITION_FOLLOWING );
		expect( updateSitesSortOrder ).toHaveBeenCalledWith( [ 'running-site', 'stopped-site' ] );
	} );

	it( 'animates other sites into the drop placeholder while dragging', () => {
		render( <SiteList /> );

		const stoppedRow = document.querySelector( '[data-reorder-id="stopped-site"]' );
		const runningRow = document.querySelector( '[data-reorder-id="running-site"]' );
		const originalAnimate = Element.prototype.animate;
		const animateMock = vi.fn(
			() =>
				( {
					cancel: vi.fn(),
					oncancel: null,
					onfinish: null,
				} ) as unknown as Animation
		);

		expect( stoppedRow ).toBeInTheDocument();
		expect( runningRow ).toBeInTheDocument();

		let runningTop = 35;
		vi.spyOn( stoppedRow!, 'getBoundingClientRect' ).mockReturnValue(
			createRect( {
				top: 0,
				left: 8,
				width: 272,
				height: 34,
			} )
		);
		vi.spyOn( runningRow!, 'getBoundingClientRect' ).mockImplementation( () =>
			createRect( {
				top: runningTop,
				left: 8,
				width: 272,
				height: 34,
			} )
		);

		Element.prototype.animate = animateMock as unknown as Element[ 'animate' ];

		try {
			fireEvent(
				stoppedRow!,
				createPointerEvent( 'pointerdown', {
					button: 0,
					clientX: 16,
					clientY: 10,
				} )
			);

			runningTop = 0;
			fireEvent( window, createPointerEvent( 'pointermove', { clientX: 16, clientY: 70 } ) );

			expect( animateMock ).toHaveBeenCalledWith(
				[ { transform: 'translate(0px, 35px)' }, { transform: 'translate(0, 0)' } ],
				expect.objectContaining( {
					duration: 160,
					easing: 'cubic-bezier(0.2, 0, 0, 1)',
				} )
			);
		} finally {
			// End the drag so its window pointer listeners don't leak into
			// later tests.
			fireEvent( window, createPointerEvent( 'pointerup', { clientX: 16, clientY: 70 } ) );
			if ( originalAnimate ) {
				Element.prototype.animate = originalAnimate;
			} else {
				Reflect.deleteProperty( Element.prototype, 'animate' );
			}
		}
	} );

	it( 'creates a chat when a site has no active chats', () => {
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'archived-chat',
					firstPrompt: 'Archived chat',
					ownerSitePath: '/Users/example/Studio/running-site',
					archived: true,
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList /> );

		expect( screen.queryByText( 'Archived chat' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Running Site' } ) );

		expect( navigateMock ).toHaveBeenCalledWith( {
			to: '/sites/$siteId/new',
			params: { siteId: 'running-site' },
		} );
	} );

	it( 'shows pending chat activity before the site name', () => {
		useSiteAgentActivityMock.mockReturnValue( 'pending-question' );

		render( <SiteList /> );

		const stoppedSiteRow = screen.getByText( 'Stopped Site' ).closest( 'section' )!;
		const indicator = within( stoppedSiteRow ).getByRole( 'status', {
			name: 'Studio needs an answer.',
		} );
		const siteName = screen.getByText( 'Stopped Site' );

		expect( indicator ).toBeInTheDocument();
		expect( indicator.compareDocumentPosition( siteName ) & Node.DOCUMENT_POSITION_FOLLOWING ).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
	} );

	// Without a per-row indicator there is nothing to tell two concurrent imports
	// apart — the toast that used to carry this named no site.
	it( 'shows activity on the importing row only', () => {
		useSiteAgentActivityMock.mockReturnValue( 'idle' );
		useSiteSyncActivityMock.mockImplementation( ( siteId ) =>
			siteId === 'running-site' ? { kind: 'pending', direction: 'import' } : null
		);

		render( <SiteList /> );

		const importingRow = screen.getByText( 'Running Site' ).closest( 'section' )!;
		const otherRow = screen.getByText( 'Stopped Site' ).closest( 'section' )!;

		expect(
			within( importingRow ).getByRole( 'status', { name: 'Importing backup' } )
		).toBeInTheDocument();
		expect( within( otherRow ).queryByRole( 'status' ) ).not.toBeInTheDocument();
	} );

	it( 'shows live sync activity before the site name while a site is syncing', () => {
		useSiteAgentActivityMock.mockReturnValue( 'working' );
		useSiteSyncActivityMock.mockImplementation( ( siteId ) =>
			siteId === 'running-site' ? { kind: 'pending', direction: 'push', phase: 'uploading' } : null
		);

		render( <SiteList /> );

		const runningSiteRow = screen.getByText( 'Running Site' ).closest( 'section' )!;
		const indicator = within( runningSiteRow ).getByRole( 'status', {
			name: 'Syncing live site',
		} );
		const siteName = screen.getByText( 'Running Site' );

		expect( indicator ).toBeInTheDocument();
		expect( indicator.compareDocumentPosition( siteName ) & Node.DOCUMENT_POSITION_FOLLOWING ).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(
			within( runningSiteRow ).queryByRole( 'status', { name: 'Working…' } )
		).not.toBeInTheDocument();
	} );

	it( 'marks an unread chat until it is open', () => {
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'stopped-chat',
					ownerSitePath: '/Users/example/Studio/stopped-site',
					unread: true,
				} ),
			],
			isLoading: false,
		} );

		const { rerender } = render( <SiteList sections /> );
		expect( screen.getByRole( 'img', { name: 'Unread' } ) ).toBeInTheDocument();

		paramsMock = { sessionId: 'stopped-chat' };
		pathnameMock = '/sessions/stopped-chat';
		rerender( <SiteList sections /> );
		expect( screen.queryByRole( 'img', { name: 'Unread' } ) ).not.toBeInTheDocument();
	} );

	it( 'names the configured editor and terminal in the site actions', async () => {
		useUserPreferencesMock.mockReturnValue( {
			data: {
				editor: 'zed',
				terminal: 'terminal',
				colorScheme: 'system',
				locale: 'en',
				analyticsEnabled: true,
				defaultSiteDirectory: '',
				studioCliInstalled: false,
				studioCliExternallyManaged: false,
				agenticFeaturesEnabled: true,
			},
		} );

		render( <SiteList /> );

		fireEvent.contextMenu( screen.getByText( 'Stopped Site' ) );

		const editorItem = await screen.findByText( 'Open in Zed' );
		expect( screen.getByText( 'Open in Terminal' ) ).toBeInTheDocument();

		fireEvent.click( editorItem );
		expect( useConnectorMock().openSiteInEditor ).toHaveBeenCalledWith( 'stopped-site' );
	} );
} );

function createPointerEvent(
	type: 'pointerdown' | 'pointermove' | 'pointerup',
	options: { button?: number; clientX: number; clientY: number }
) {
	const event = new MouseEvent( type, {
		bubbles: true,
		cancelable: true,
		button: options.button ?? 0,
		clientX: options.clientX,
		clientY: options.clientY,
	} );
	Object.defineProperty( event, 'pointerId', { value: 1 } );
	return event;
}

function createRect( {
	top,
	left,
	width,
	height,
}: {
	top: number;
	left: number;
	width: number;
	height: number;
} ): DOMRect {
	return {
		top,
		left,
		right: left + width,
		bottom: top + height,
		width,
		height,
		x: left,
		y: top,
		toJSON: () => ( {} ),
	} as DOMRect;
}

function createSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	return {
		id: 'site-1',
		name: 'Demo Site',
		path: '/Users/example/Studio/demo-site',
		port: 8881,
		running: false,
		phpVersion: '8.4',
		...overrides,
	};
}

function createSession( overrides: Partial< AiSessionSummary > = {} ): AiSessionSummary {
	return {
		id: 'session-1',
		filePath: '/Users/example/.studio/sessions/session-1.jsonl',
		createdAt: '2026-06-01T12:00:00.000Z',
		updatedAt: '2026-06-20T12:00:00.000Z',
		firstPrompt: 'Site chat',
		ownerSitePath: '/Users/example/Studio/demo-site',
		activeEnvironment: 'local',
		eventCount: 1,
		...overrides,
	};
}
