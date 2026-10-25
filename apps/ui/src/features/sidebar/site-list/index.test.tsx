import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSiteAgentActivity } from '@/data/agent-runs/use-agent-run';
import { getVisibleToasts, resetAppMessagesForTests } from '@/data/app-messages';
import { useConnector } from '@/data/core';
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
import { rememberVisit } from '@/features/sidebar/last-visited';
import { SiteList } from './index';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

const navigateMock = vi.fn();
const FILE_MANAGER = /^(Finder|File Explorer|File manager)$/;
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

let needingInputMock: string[] = [];
let busySessionsMock: string[] = [];
let pinsMock: string[] = [];
let sidebarPreferencesMock: {
	chatOrder: Record< string, string[] >;
	showRecentChats: boolean;
	autoCollapseSites: boolean;
};
const togglePin = vi.hoisted( () => vi.fn() );
const saveSidebar = vi.hoisted( () => vi.fn() );

vi.mock( '@/data/queries/use-sidebar-pins', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	useSidebarPins: () => ( {
		pins: pinsMock,
		setPins: ( sidebarPins: string[] ) => saveSidebar( { sidebarPins } ),
		isPinned: ( key: string ) => pinsMock.includes( key ),
		togglePin,
	} ),
	useSidebarPreferences: () => ( { pins: pinsMock, ...sidebarPreferencesMock, save: saveSidebar } ),
} ) );

vi.mock( '@/data/agent-runs/use-agent-run', () => ( {
	useSiteAgentActivity: vi.fn(),
	useSessionsNeedingInput: () => needingInputMock,
	useSessionsBusy: ( ids: string[] ) => ids.some( ( id ) => busySessionsMock.includes( id ) ),
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
		reason: null,
		isReady: true,
	} ) ),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-installed-apps', () => ( {
	useInstalledApps: () => ( { data: undefined } ),
} ) );

vi.mock( '@/data/sync-activity', () => ( {
	useSiteSyncActivity: vi.fn(),
} ) );

vi.mock( '@/data/use-session-ui', () => ( {
	useSessionPreviewUI: () => ( { siteId: null } ),
} ) );

vi.mock( '@/features/sync/publish-panel/publish-menu', () => ( {
	SitePublishMenu: () => null,
} ) );

vi.mock( '@/features/sharing/share-dialog/share-menu-item', () => ( {
	SiteShareMenuItem: () => null,
} ) );

vi.mock( '@/features/sites/import-site-dialog', () => ( {
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
	afterEach( () => {
		resetAppMessagesForTests();
	} );

	const startSite = vi.fn();
	const stopSite = vi.fn();
	const updateSitesSortOrder = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		needingInputMock = [];
		busySessionsMock = [];
		pinsMock = [];
		sidebarPreferencesMock = { chatOrder: {}, showRecentChats: true, autoCollapseSites: true };
		window.localStorage.clear();
		paramsMock = {};
		pathnameMock = '/';

		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: true,
			chatEnabled: true,
			reason: null,
			isReady: true,
		} );
		useIsSiteBusyMock.mockReturnValue( false );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
		useSiteAgentActivityMock.mockReturnValue( 'idle' );
		useSiteSyncActivityMock.mockReturnValue( null );
		useSessionsMock.mockReturnValue( { data: [], isLoading: false } );
		archiveSession.mockResolvedValue( undefined );
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
		// Starting a site also opens it; stopping one leaves the user where they are.
		expect( navigateMock ).toHaveBeenCalledTimes( 1 );
		expect( navigateMock ).toHaveBeenCalledWith( {
			to: '/sites/$siteId/new',
			params: { siteId: 'stopped-site' },
		} );
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

	it( 'opens a stopped site started from its row’s right-click menu, as its start button does', async () => {
		render( <SiteList /> );

		fireEvent.contextMenu( screen.getByText( 'Stopped Site' ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: /^Start site/ } ) );

		expect( startSite ).toHaveBeenCalledWith( 'stopped-site' );
		expect( navigateMock ).toHaveBeenCalledWith( {
			to: '/sites/$siteId/new',
			params: { siteId: 'stopped-site' },
		} );
	} );

	it( 'opens site actions from a row right-click without opening the latest chat', async () => {
		render( <SiteList /> );

		fireEvent.contextMenu( screen.getByText( 'Stopped Site' ) );

		expect( navigateMock ).not.toHaveBeenCalled();
		expect( await screen.findByText( 'Settings' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Duplicate' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Delete site' ) ).toBeInTheDocument();
	} );

	it( 'opens the site folder through the connector and records a Tracks event', async () => {
		render( <SiteList /> );

		await openIn( 'Stopped Site' );
		fireEvent.click( await screen.findByText( FILE_MANAGER ) );

		expect( useConnectorMock().openSiteFolder ).toHaveBeenCalledWith( 'stopped-site' );
		expect( useConnectorMock().trackEvent ).toHaveBeenCalledWith( 'studio_site_open_folder' );
	} );

	it( 'opens phpMyAdmin and WP Admin through the host so the session is kept', async () => {
		render( <SiteList /> );

		await openIn( 'Running Site' );
		fireEvent.click( await screen.findByText( 'phpMyAdmin' ) );

		await openIn( 'Running Site' );
		fireEvent.click( await screen.findByText( 'Browser (WP Admin)' ) );

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

		await openIn( 'Stopped Site' );

		expect( await screen.findByText( 'Browser' ) ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( screen.getByText( 'phpMyAdmin' ) ).not.toHaveAttribute( 'aria-disabled' );
		expect( screen.getByText( 'Browser (WP Admin)' ) ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( screen.getByText( FILE_MANAGER ) ).not.toHaveAttribute( 'aria-disabled' );
	} );

	it( 'opens site settings from the site actions menu', async () => {
		const onSiteOpen = vi.fn();
		render( <SiteList onSiteOpen={ onSiteOpen } /> );

		fireEvent.contextMenu( screen.getByText( 'Stopped Site' ) );
		fireEvent.click( await screen.findByText( 'Settings' ) );

		expect( onSiteOpen ).toHaveBeenCalledTimes( 1 );
		expect( navigateMock ).toHaveBeenCalledTimes( 1 );
		expect( navigateMock.mock.lastCall?.[ 0 ].search( {} ) ).toEqual( {
			settings: 'site',
			settingsSite: 'stopped-site',
		} );
		expect( useConnectorMock().trackEvent ).toHaveBeenCalledWith( 'studio_panel_opened', {
			panel: 'settings',
		} );
	} );

	it( 'opens a chat when clicking a site while signed out', () => {
		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: false,
			chatEnabled: true,
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

	it( "opens the site's page when Studio Code is switched off", () => {
		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: true,
			chatEnabled: false,
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

	it( 'lists sites while chats are still loading', () => {
		useSessionsMock.mockReturnValue( { data: undefined, isLoading: true } );

		render( <SiteList sections /> );

		expect( screen.getByText( 'Stopped Site' ) ).toBeInTheDocument();
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

		const row = screen.getByText( 'Xdebug Site' ).closest( 'li' )!;
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

		const stoppedRow = screen.getByText( 'Stopped Site' ).closest( 'li' )!;
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
		const openSite = within( sites ).getByText( 'Stopped Site' ).closest( 'li' )!;
		expect( within( openSite ).getByRole( 'button', { name: 'Add a menu' } ) ).toHaveAttribute(
			'aria-current',
			'page'
		);
		expect( within( sites ).queryByText( 'Make it blue' ) ).not.toBeInTheDocument();
		const recent = screen.getByRole( 'group', { name: 'Recent' } );
		expect( within( recent ).getByRole( 'button', { name: 'Make it blue' } ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Old idea' ) ).not.toBeInTheDocument();

		fireEvent.click( within( openSite ).getByRole( 'button', { name: 'Archive chat' } ) );
		await waitFor( () =>
			expect( navigateMock ).toHaveBeenLastCalledWith( {
				to: '/sites/$siteId/new',
				params: { siteId: 'stopped-site' },
			} )
		);
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

	it( 'archives several chats picked with ⌘/Ctrl-click from one menu', async () => {
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'chat-a',
					firstPrompt: 'Make it blue',
					ownerSitePath: '/Users/example/Studio/running-site',
				} ),
				createSession( {
					id: 'chat-b',
					firstPrompt: 'Add a menu',
					ownerSitePath: '/Users/example/Studio/stopped-site',
				} ),
			],
			isLoading: false,
		} );
		archiveSession.mockResolvedValue( undefined );

		render( <SiteList sections /> );

		const recent = screen.getByRole( 'group', { name: 'Recent' } );
		fireEvent.click( within( recent ).getByText( 'Make it blue' ), { metaKey: true } );
		fireEvent.click( within( recent ).getByText( 'Add a menu' ), { metaKey: true } );
		expect( screen.getByText( '2 chats selected' ) ).toHaveAttribute( 'role', 'status' );
		expect( within( recent ).getByRole( 'button', { name: 'Make it blue' } ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect( screen.getByRole( 'button', { name: 'Stopped Site' } ) ).toHaveAttribute(
			'aria-pressed',
			'false'
		);
		expect( navigateMock ).not.toHaveBeenCalled();

		fireEvent.contextMenu( within( recent ).getByText( 'Add a menu' ) );
		fireEvent.keyDown( await screen.findByRole( 'menu' ), { key: 'Escape' } );
		expect( screen.getByText( '2 chats selected' ) ).toBeInTheDocument();
		fireEvent.contextMenu( within( recent ).getByText( 'Add a menu' ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Archive 2 chats' } ) );

		await waitFor( () => expect( archiveSession ).toHaveBeenCalledTimes( 2 ) );
		expect( archiveSession ).toHaveBeenCalledWith( {
			sessionId: 'chat-a',
			patch: { archived: true },
		} );
	} );

	it( 'keeps the sites and the chats that failed selected after a bulk chat action', async () => {
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'chat-a',
					firstPrompt: 'Make it blue',
					ownerSitePath: '/Users/example/Studio/running-site',
				} ),
				createSession( {
					id: 'chat-b',
					firstPrompt: 'Add a menu',
					ownerSitePath: '/Users/example/Studio/stopped-site',
				} ),
			],
			isLoading: false,
		} );
		archiveSession.mockImplementation( async ( { sessionId }: { sessionId: string } ) => {
			if ( sessionId === 'chat-b' ) {
				throw new Error( 'Disk full' );
			}
		} );

		render( <SiteList sections /> );

		const recent = screen.getByRole( 'group', { name: 'Recent' } );
		const sites = screen.getByRole( 'group', { name: 'Sites' } );
		fireEvent.click( within( recent ).getByText( 'Make it blue' ), { metaKey: true } );
		fireEvent.click( within( recent ).getByText( 'Add a menu' ), { metaKey: true } );
		fireEvent.click( within( sites ).getByText( 'Stopped Site' ), { metaKey: true } );
		fireEvent.contextMenu( within( recent ).getByText( 'Add a menu' ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Archive 2 chats' } ) );

		await waitFor( () =>
			expect( getVisibleToasts()[ 0 ]?.title ).toBe( '1 of 2 items updated. 1 failed.' )
		);
		expect( screen.getByText( '2 items selected' ) ).toHaveAttribute( 'role', 'status' );
		expect( within( recent ).getByRole( 'button', { name: 'Add a menu' } ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	} );

	it( 'starts a ⌘/Ctrl-click selection from the open chat, never from its site', async () => {
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'new-chat',
					firstPrompt: undefined,
					ownerSitePath: '/Users/example/Studio/running-site',
				} ),
				createSession( {
					id: 'chat-a',
					firstPrompt: 'Make it blue',
					ownerSitePath: '/Users/example/Studio/stopped-site',
				} ),
				createSession( {
					id: 'chat-b',
					firstPrompt: 'Add a menu',
					ownerSitePath: '/Users/example/Studio/stopped-site',
				} ),
			],
			isLoading: false,
		} );
		paramsMock = { sessionId: 'new-chat' };
		pathnameMock = '/sessions/new-chat';

		render( <SiteList sections /> );

		const recent = screen.getByRole( 'group', { name: 'Recent' } );
		fireEvent.click( within( recent ).getByText( 'Make it blue' ), { metaKey: true } );
		fireEvent.click( within( recent ).getByText( 'Add a menu' ), { metaKey: true } );
		expect( screen.getByText( '3 chats selected' ) ).toHaveAttribute( 'role', 'status' );

		fireEvent.contextMenu( within( recent ).getByText( 'Add a menu' ) );
		expect( await screen.findByRole( 'menuitem', { name: 'Archive 3 chats' } ) ).toBeVisible();
		expect( screen.queryByRole( 'menuitem', { name: /Delete/ } ) ).not.toBeInTheDocument();
	} );

	it( 'moves chats waiting on an answer to Needs input, out of Recent and Pinned', () => {
		needingInputMock = [ 'other-chat' ];
		pinsMock = [ 'chat:other-chat' ];
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'other-chat',
					firstPrompt: 'Make it blue',
					ownerSitePath: '/Users/example/Studio/running-site',
				} ),
				createSession( {
					id: 'idle-chat',
					firstPrompt: 'Add a menu',
					ownerSitePath: '/Users/example/Studio/stopped-site',
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList sections /> );

		const needsInput = screen.getByRole( 'group', { name: 'Needs input' } );
		expect( within( needsInput ).getByText( 'Make it blue' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'group', { name: 'Pinned' } ) ).not.toBeInTheDocument();
		const recent = screen.getByRole( 'group', { name: 'Recent' } );
		expect( within( recent ).queryByText( 'Make it blue' ) ).not.toBeInTheDocument();
		expect( within( recent ).getByText( 'Add a menu' ) ).toBeInTheDocument();
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

		// A focused row takes the shortcut without opening its menu.
		fireEvent.keyDown( within( sites ).getByRole( 'button', { name: 'Running Site' } ), {
			key: 'π',
			code: 'KeyP',
			ctrlKey: true,
			altKey: true,
		} );
		expect( togglePin ).toHaveBeenLastCalledWith( 'site:running-site' );
		togglePin.mockClear();

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

		const stoppedRow = screen.getByText( 'Stopped Site' ).closest( 'li' )!;
		const siteButton = within( stoppedRow ).getByRole( 'button', { name: 'Stopped Site' } );

		expect( siteButton ).not.toHaveAttribute( 'aria-current' );
		expect( siteButton.closest( '[data-slot="sidebar-menu-button"]' ) ).toHaveAttribute(
			'data-active'
		);
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

		const stoppedRow = screen
			.getByText( 'Stopped Site' )
			.closest( '[data-slot="sidebar-menu-button"]' );
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

		expect( stoppedRow ).toHaveAttribute( 'data-drag-source' );
		expect( runningRow ).toHaveAttribute( 'data-drop-position', 'after' );
		expect( updateSitesSortOrder ).not.toHaveBeenCalled();

		fireEvent( window, createPointerEvent( 'pointerup', { clientX: 16, clientY: 70 } ) );

		const stoppedSite = screen.getByText( 'Stopped Site' );
		const runningSite = screen.getByText( 'Running Site' );

		expect(
			runningSite.compareDocumentPosition( stoppedSite ) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBe( Node.DOCUMENT_POSITION_FOLLOWING );
		expect( updateSitesSortOrder ).toHaveBeenCalledWith( [ 'running-site', 'stopped-site' ] );
	} );

	it( 'flies a dropped site into its new slot, hidden until it lands', () => {
		render( <SiteList /> );

		const stoppedRow = document.querySelector( '[data-reorder-id="stopped-site"]' )!;
		const runningRow = document.querySelector( '[data-reorder-id="running-site"]' )!;
		let stoppedTop = 0;
		vi.spyOn( stoppedRow, 'getBoundingClientRect' ).mockImplementation( () =>
			createRect( { top: stoppedTop, left: 8, width: 272, height: 34 } )
		);
		vi.spyOn( runningRow, 'getBoundingClientRect' ).mockReturnValue(
			createRect( { top: 35, left: 8, width: 272, height: 34 } )
		);
		const animation = { onfinish: null as null | ( () => void ), cancel: vi.fn() };
		const animate = vi.fn( () => animation as unknown as Animation );
		Element.prototype.animate = animate as unknown as Element[ 'animate' ];
		document.documentElement.style.setProperty( '--motion-duration-surface', '180ms' );

		try {
			fireEvent(
				stoppedRow,
				createPointerEvent( 'pointerdown', { button: 0, clientX: 16, clientY: 10 } )
			);
			fireEvent( window, createPointerEvent( 'pointermove', { clientX: 16, clientY: 70 } ) );
			stoppedTop = 35;
			fireEvent( window, createPointerEvent( 'pointerup', { clientX: 16, clientY: 70 } ) );

			expect( animate ).toHaveBeenCalledWith(
				[ { transform: 'none' }, expect.objectContaining( { transform: expect.any( String ) } ) ],
				expect.objectContaining( { duration: 180, fill: 'forwards' } )
			);
			expect( document.querySelector( '[data-reorder-id="stopped-site"]' ) ).toHaveAttribute(
				'data-dropping'
			);

			act( () => animation.onfinish?.() );
			expect( document.querySelector( '[data-reorder-id="stopped-site"]' ) ).not.toHaveAttribute(
				'data-dropping'
			);
		} finally {
			document.documentElement.style.removeProperty( '--motion-duration-surface' );
			Reflect.deleteProperty( Element.prototype, 'animate' );
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

	it( 'leaves chat activity to the chat rows, not the site row', () => {
		useSiteAgentActivityMock.mockReturnValue( 'working' );

		render( <SiteList /> );

		const stoppedSiteRow = screen.getByText( 'Stopped Site' ).closest( 'li' )!;
		expect( within( stoppedSiteRow ).queryByRole( 'status' ) ).not.toBeInTheDocument();
	} );

	// Without a per-row indicator there is nothing to tell two concurrent imports
	// apart — the toast that used to carry this named no site.
	it( 'shows activity on the importing row only', () => {
		useSiteAgentActivityMock.mockReturnValue( 'idle' );
		useSiteSyncActivityMock.mockImplementation( ( siteId ) =>
			siteId === 'running-site' ? { kind: 'pending', direction: 'import' } : null
		);

		render( <SiteList /> );

		const importingRow = screen.getByText( 'Running Site' ).closest( 'li' )!;
		const otherRow = screen.getByText( 'Stopped Site' ).closest( 'li' )!;

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

		const runningSiteRow = screen.getByText( 'Running Site' ).closest( 'li' )!;
		const indicator = within( runningSiteRow ).getByRole( 'status', {
			name: 'Syncing live site',
		} );
		const siteName = screen.getByText( 'Running Site' );

		expect( indicator ).toBeInTheDocument();
		expect( indicator.compareDocumentPosition( siteName ) & Node.DOCUMENT_POSITION_FOLLOWING ).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
	} );

	it( 'shimmers the title of a chat whose agent is working', () => {
		useSiteAgentActivityMock.mockReturnValue( 'working' );
		paramsMock = { siteId: 'stopped-site' };
		pathnameMock = '/sites/stopped-site/new';
		useSessionsMock.mockReturnValue( {
			data: createChats( '/Users/example/Studio/stopped-site', 1 ),
			isLoading: false,
		} );

		render( <SiteList sections /> );

		const titles = screen.getAllByText( 'Chat 1' );
		expect( titles[ 0 ] ).toHaveClass( 'studio-shimmer' );
		expect( screen.getAllByRole( 'button', { name: 'Working… Chat 1' } ) ).toHaveLength(
			titles.length
		);
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

	it( 'reaches every chat under a site with Show more, ten at a time', () => {
		paramsMock = { siteId: 'stopped-site' };
		pathnameMock = '/sites/stopped-site/new';
		sidebarPreferencesMock.showRecentChats = false;
		useSessionsMock.mockReturnValue( {
			data: createChats( '/Users/example/Studio/stopped-site', 17 ),
			isLoading: false,
		} );

		render( <SiteList sections /> );

		const chats = screen.getByRole( 'group', { name: 'Stopped Site chats' } );
		const listed = () => within( chats ).getAllByRole( 'button', { name: /^Chat \d+$/ } );
		expect( listed() ).toHaveLength( 5 );
		fireEvent.click( within( chats ).getByRole( 'button', { name: 'Show more' } ) );
		expect( listed() ).toHaveLength( 15 );
		fireEvent.click( within( chats ).getByRole( 'button', { name: 'Show more' } ) );
		expect( listed() ).toHaveLength( 17 );
		expect(
			within( chats ).queryByRole( 'button', { name: 'Show more' } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'group', { name: 'Recent' } ) ).not.toBeInTheDocument();
	} );

	it( 'lists the latest ten chats in Recent', () => {
		useSessionsMock.mockReturnValue( {
			data: createChats( '/Users/example/Studio/running-site', 17 ),
			isLoading: false,
		} );

		render( <SiteList sections /> );

		const recent = screen.getByRole( 'group', { name: 'Recent' } );
		expect(
			within( recent )
				.getAllByRole( 'button', { name: /^Chat \d+$/ } )
				.map( ( button ) => button.textContent )
		).toEqual( Array.from( { length: 10 }, ( _, index ) => `Chat ${ index + 1 }` ) );
	} );

	it( 'leaves a new chat out of Recent until its first prompt, unless it is open', () => {
		const chats = [
			...createChats( '/Users/example/Studio/running-site', 1 ),
			createSession( {
				id: 'empty-chat',
				firstPrompt: undefined,
				ownerSitePath: '/Users/example/Studio/running-site',
			} ),
		];
		useSessionsMock.mockReturnValue( { data: chats, isLoading: false } );
		const { rerender } = render( <SiteList sections /> );
		const recent = () => screen.getByRole( 'group', { name: 'Recent' } );
		expect(
			within( recent() ).queryByRole( 'button', { name: 'New chat' } )
		).not.toBeInTheDocument();

		paramsMock = { sessionId: 'empty-chat' };
		rerender( <SiteList sections /> );
		expect( within( recent() ).getByRole( 'button', { name: 'New chat' } ) ).toBeVisible();
	} );

	it( 'archives every selected chat with ⇧⌘A in a bulk menu, not just the one clicked', async () => {
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'chat-a',
					firstPrompt: 'Make it blue',
					ownerSitePath: '/Users/example/Studio/running-site',
				} ),
				createSession( {
					id: 'chat-b',
					firstPrompt: 'Add a menu',
					ownerSitePath: '/Users/example/Studio/stopped-site',
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList sections /> );

		const recent = screen.getByRole( 'group', { name: 'Recent' } );
		fireEvent.click( within( recent ).getByText( 'Make it blue' ), { metaKey: true } );
		fireEvent.click( within( recent ).getByText( 'Add a menu' ), { metaKey: true } );
		fireEvent.contextMenu( within( recent ).getByText( 'Add a menu' ) );
		fireEvent.keyDown( await screen.findByRole( 'menu' ), {
			key: 'A',
			ctrlKey: true,
			shiftKey: true,
		} );

		await waitFor( () => expect( archiveSession ).toHaveBeenCalledTimes( 2 ) );
		expect( archiveSession ).toHaveBeenCalledWith( {
			sessionId: 'chat-a',
			patch: { archived: true },
		} );
		expect( archiveSession ).toHaveBeenCalledWith( {
			sessionId: 'chat-b',
			patch: { archived: true },
		} );
		await waitFor( () => expect( getVisibleToasts()[ 0 ]?.title ).toBe( '2 chats archived' ) );
	} );

	it( 'opens the bulk menu with Shift+F10, pins every selected row with ⌥⌘P, and names the sites ⌘⌫ deletes', async () => {
		render( <SiteList sections /> );

		const selectBothSites = async () => {
			const sites = screen.getByRole( 'group', { name: 'Sites' } );
			fireEvent.click( within( sites ).getByText( 'Stopped Site' ), { metaKey: true } );
			fireEvent.click( within( sites ).getByText( 'Running Site' ), { metaKey: true } );
			fireEvent.keyDown( within( sites ).getByRole( 'button', { name: 'Running Site' } ), {
				key: 'F10',
				shiftKey: true,
			} );
			// A closed menu stays mounted for its exit transition.
			return waitFor( () => {
				const menu = document.querySelector( '[role="menu"]:not([data-closed])' );
				expect( menu ).toBeInTheDocument();
				return menu!;
			} );
		};

		fireEvent.keyDown( await selectBothSites(), {
			key: 'p',
			keyCode: 80,
			ctrlKey: true,
			altKey: true,
		} );
		expect( saveSidebar ).toHaveBeenCalledWith( {
			sidebarPins: [ 'site:stopped-site', 'site:running-site' ],
		} );
		expect( togglePin ).not.toHaveBeenCalled();
		expect( screen.getByRole( 'menu' ) ).toHaveAttribute( 'data-closed' );

		fireEvent.keyDown( await selectBothSites(), { key: 'Backspace', ctrlKey: true } );
		const dialog = await screen.findByRole( 'alertdialog' );
		expect( dialog ).toHaveTextContent( 'Remove 2 sites from WordPress Studio?' );
		expect(
			within( dialog )
				.getAllByRole( 'listitem' )
				.map( ( item ) => item.textContent )
		).toEqual( [ 'Stopped Site', 'Running Site' ] );
	} );

	it( 'holds off archiving and deleting while a chat is running or has prompts queued', async () => {
		busySessionsMock = [ 'chat-b' ];
		paramsMock = { siteId: 'stopped-site' };
		pathnameMock = '/sites/stopped-site';
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'chat-a',
					firstPrompt: 'Make it blue',
					ownerSitePath: '/Users/example/Studio/running-site',
				} ),
				createSession( {
					id: 'chat-b',
					firstPrompt: 'Add a menu',
					ownerSitePath: '/Users/example/Studio/stopped-site',
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList sections /> );

		const siteChats = screen.getByRole( 'group', { name: 'Stopped Site chats' } );
		expect( within( siteChats ).getByRole( 'button', { name: 'Archive chat' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);

		const recent = screen.getByRole( 'group', { name: 'Recent' } );
		fireEvent.click( within( recent ).getByText( 'Make it blue' ), { metaKey: true } );
		fireEvent.click( within( recent ).getByText( 'Add a menu' ), { metaKey: true } );
		fireEvent.contextMenu( within( recent ).getByText( 'Add a menu' ) );
		const menu = await screen.findByRole( 'menu' );
		expect( within( menu ).getByRole( 'menuitem', { name: /Archive 2 chats/ } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( menu ).toHaveTextContent( 'Wait for active chats and queued prompts to finish.' );
		fireEvent.keyDown( menu, { key: 'A', ctrlKey: true, shiftKey: true } );
		expect( archiveSession ).not.toHaveBeenCalled();
	} );

	it( 'leaves an archived open chat for the site’s top chat still listed, in sidebar order', async () => {
		paramsMock = { sessionId: 'chat-1' };
		pathnameMock = '/sessions/chat-1';
		pinsMock = [ 'chat:chat-4' ];
		sidebarPreferencesMock.chatOrder = {
			'stopped-site': [ 'chat-1', 'chat-4', 'chat-3', 'chat-2' ],
		};
		useSessionsMock.mockReturnValue( {
			data: createChats( '/Users/example/Studio/stopped-site', 4 ),
			isLoading: false,
		} );

		render( <SiteList sections /> );

		const chats = screen.getByRole( 'group', { name: 'Stopped Site chats' } );
		fireEvent.click( within( chats ).getAllByRole( 'button', { name: 'Archive chat' } )[ 0 ] );

		await waitFor( () =>
			expect( navigateMock ).toHaveBeenLastCalledWith( {
				to: '/sessions/$sessionId',
				params: { sessionId: 'chat-3' },
			} )
		);
	} );

	it( 'says when archiving a chat fails, and stays on it', async () => {
		paramsMock = { sessionId: 'site-chat' };
		pathnameMock = '/sessions/site-chat';
		archiveSession.mockRejectedValue( new Error( 'Disk full' ) );
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'site-chat',
					firstPrompt: 'Add a menu',
					ownerSitePath: '/Users/example/Studio/stopped-site',
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList sections /> );

		fireEvent.click( screen.getAllByRole( 'button', { name: 'Archive chat' } )[ 0 ] );
		await waitFor( () =>
			expect( getVisibleToasts()[ 0 ] ).toMatchObject( {
				title: 'Couldn’t archive the chat',
				description: 'Disk full',
			} )
		);
		expect( navigateMock ).not.toHaveBeenCalled();
	} );

	it( 'folds and unfolds sites from their row, keeping several open when asked to', () => {
		sidebarPreferencesMock = { chatOrder: {}, showRecentChats: false, autoCollapseSites: false };
		paramsMock = { sessionId: 'stopped-chat' };
		pathnameMock = '/sessions/stopped-chat';
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'stopped-chat',
					firstPrompt: 'Add a menu',
					ownerSitePath: '/Users/example/Studio/stopped-site',
				} ),
				createSession( {
					id: 'running-chat',
					firstPrompt: 'Make it blue',
					ownerSitePath: '/Users/example/Studio/running-site',
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList sections /> );

		expect( screen.getByText( 'Add a menu' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Make it blue' ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Running Site' } ) );
		expect( screen.getByText( 'Add a menu' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Make it blue' ) ).toBeInTheDocument();

		// The open site's row folds its chats.
		fireEvent.click( screen.getByRole( 'button', { name: 'Stopped Site' } ) );
		expect( screen.queryByText( 'Add a menu' ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Stopped Site' } ) );
		expect( screen.getByText( 'Add a menu' ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Collapse all' } ) );
		expect( screen.queryByText( 'Add a menu' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Make it blue' ) ).not.toBeInTheDocument();

		// Folding the group folds its sites too.
		fireEvent.click( screen.getByRole( 'button', { name: 'Stopped Site' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Sites' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Sites' } ) );
		expect( screen.getByRole( 'button', { name: 'Stopped Site' } ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Add a menu' ) ).not.toBeInTheDocument();
	} );

	it( 'remembers collapsed groups, and opens one when something is added to it', () => {
		window.localStorage.setItem( 'studio-ui-sidebar-group-pinned', 'false' );
		window.localStorage.setItem( 'studio-ui-sidebar-group-recent', 'false' );
		const { unmount } = render( <SiteList sections /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Sites' } ) );
		expect( screen.queryByText( 'Stopped Site' ) ).not.toBeInTheDocument();
		unmount();

		const { rerender } = render( <SiteList sections /> );
		expect( screen.queryByText( 'Stopped Site' ) ).not.toBeInTheDocument();

		useSitesMock.mockReturnValue( {
			data: [
				...( useSitesMock().data ?? [] ),
				createSite( { id: 'new-site', name: 'New Site', path: '/Users/example/Studio/new-site' } ),
			],
			isLoading: false,
		} );
		rerender( <SiteList sections /> );
		expect( screen.getByText( 'New Site' ) ).toBeInTheDocument();

		// Groups that were empty open on their first item.
		pinsMock = [ 'site:stopped-site' ];
		useSessionsMock.mockReturnValue( {
			data: [ createSession( { firstPrompt: 'First chat' } ) ],
			isLoading: false,
		} );
		rerender( <SiteList sections /> );
		const pinned = within( screen.getByRole( 'group', { name: 'Pinned' } ) );
		expect( pinned.getByRole( 'button', { name: 'Stopped Site' } ) ).toBeInTheDocument();
		const recent = within( screen.getByRole( 'group', { name: 'Recent' } ) );
		expect( recent.getByRole( 'button', { name: 'First chat' } ) ).toBeInTheDocument();
	} );

	it( 'drags chats into a new order within their site, announcing where one lands', () => {
		paramsMock = { siteId: 'stopped-site' };
		pathnameMock = '/sites/stopped-site/new';
		useSessionsMock.mockReturnValue( {
			data: createChats( '/Users/example/Studio/stopped-site', 2 ),
			isLoading: false,
		} );

		render( <SiteList sections /> );

		const first = document.querySelector( '[data-reorder-id="chat-1"]' )!;
		const second = document.querySelector( '[data-reorder-id="chat-2"]' )!;
		vi.spyOn( first, 'getBoundingClientRect' ).mockReturnValue(
			createRect( { top: 0, left: 0, width: 200, height: 36 } )
		);
		vi.spyOn( second, 'getBoundingClientRect' ).mockReturnValue(
			createRect( { top: 37, left: 0, width: 200, height: 36 } )
		);

		// A modifier key means the row is being selected, not dragged.
		fireEvent(
			first,
			createPointerEvent( 'pointerdown', { clientX: 10, clientY: 10, metaKey: true } )
		);
		fireEvent( window, createPointerEvent( 'pointermove', { clientX: 10, clientY: 80 } ) );
		expect( second ).not.toHaveAttribute( 'data-drop-position' );
		fireEvent( window, createPointerEvent( 'pointerup', { clientX: 10, clientY: 80 } ) );

		fireEvent( first, createPointerEvent( 'pointerdown', { clientX: 10, clientY: 10 } ) );
		fireEvent( window, createPointerEvent( 'pointermove', { clientX: 10, clientY: 80 } ) );
		expect( second ).toHaveAttribute( 'data-drop-position', 'after' );
		fireEvent( window, createPointerEvent( 'pointerup', { clientX: 10, clientY: 80 } ) );

		expect( saveSidebar ).toHaveBeenCalledWith(
			{ sidebarChatOrder: { 'stopped-site': [ 'chat-2', 'chat-1' ] } },
			'Couldn’t save the chat order'
		);
		expect( screen.getByText( 'Chat 1 moved to position 2 of 2' ) ).toBeInTheDocument();
		expect( updateSitesSortOrder ).not.toHaveBeenCalled();
	} );

	it( 'keeps chats in the order they were dragged into, newer ones on top', () => {
		paramsMock = { siteId: 'stopped-site' };
		pathnameMock = '/sites/stopped-site/new';
		sidebarPreferencesMock.showRecentChats = false;
		sidebarPreferencesMock.chatOrder = { 'stopped-site': [ 'chat-3', 'chat-2' ] };
		useSessionsMock.mockReturnValue( {
			data: createChats( '/Users/example/Studio/stopped-site', 3 ),
			isLoading: false,
		} );

		render( <SiteList sections /> );

		const chats = screen.getByRole( 'group', { name: 'Stopped Site chats' } );
		expect(
			within( chats )
				.getAllByRole( 'button', { name: /^Chat \d+$/ } )
				.map( ( button ) => button.textContent )
		).toEqual( [ 'Chat 1', 'Chat 3', 'Chat 2' ] );
	} );

	it( 'returns to the chat last open in a site', () => {
		rememberVisit( 'stopped-site', 'older-chat' );
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'older-chat',
					ownerSitePath: '/Users/example/Studio/stopped-site',
					updatedAt: '2026-06-01T12:00:00.000Z',
				} ),
				createSession( {
					id: 'latest-chat',
					ownerSitePath: '/Users/example/Studio/stopped-site',
					updatedAt: '2026-06-20T12:00:00.000Z',
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Stopped Site' } ) );

		expect( navigateMock ).toHaveBeenCalledWith( {
			to: '/sessions/$sessionId',
			params: { sessionId: 'older-chat' },
		} );
	} );

	it( 'offers to retry when chats fail to load', () => {
		const refetch = vi.fn();
		useSessionsMock.mockReturnValue( {
			data: undefined,
			isLoading: false,
			isError: true,
			refetch,
		} );

		render( <SiteList sections /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Retry loading chats' } ) );
		expect( refetch ).toHaveBeenCalled();
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

		await openIn( 'Stopped Site' );

		const editorItem = await screen.findByText( 'Zed' );
		expect( screen.getByText( 'Terminal' ) ).toBeInTheDocument();

		fireEvent.click( editorItem );
		expect( useConnectorMock().openSiteInEditor ).toHaveBeenCalledWith( 'stopped-site' );
	} );
} );

async function openIn( siteName: string ) {
	fireEvent.contextMenu( screen.getByText( siteName ) );
	fireEvent.click( await screen.findByText( 'Open in' ) );
}

function createPointerEvent(
	type: 'pointerdown' | 'pointermove' | 'pointerup',
	options: { button?: number; clientX: number; clientY: number; metaKey?: boolean }
) {
	const event = new MouseEvent( type, {
		bubbles: true,
		cancelable: true,
		button: options.button ?? 0,
		clientX: options.clientX,
		clientY: options.clientY,
		metaKey: options.metaKey,
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

// Chat 1 is the most recent.
function createChats( ownerSitePath: string, count: number ): AiSessionSummary[] {
	return Array.from( { length: count }, ( _, index ) =>
		createSession( {
			id: `chat-${ index + 1 }`,
			firstPrompt: `Chat ${ index + 1 }`,
			ownerSitePath,
			updatedAt: new Date( Date.UTC( 2026, 5, 20 ) - index * 60_000 ).toISOString(),
		} )
	);
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
