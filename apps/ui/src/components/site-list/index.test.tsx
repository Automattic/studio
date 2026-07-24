import { fireEvent, render, screen, within } from '@testing-library/react';
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

vi.mock( '@/data/queries/use-sessions', () => ( {
	useSessions: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-agent-run', () => ( {
	useSiteAgentActivity: vi.fn(),
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

vi.mock( '@/data/sync-activity', () => ( {
	useSiteSyncActivity: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useCopySiteMock = vi.mocked( useCopySite, { partial: true } );
const useDeleteSiteMock = vi.mocked( useDeleteSite, { partial: true } );
const useExportDatabaseMock = vi.mocked( useExportDatabase, { partial: true } );
const useExportFullSiteMock = vi.mocked( useExportFullSite, { partial: true } );
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
		paramsMock = {};
		pathnameMock = '/';

		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: true,
			chatEnabled: true,
			reason: null,
			isReady: true,
		} );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
		useSiteAgentActivityMock.mockReturnValue( 'idle' );
		useSiteSyncActivityMock.mockReturnValue( null );
		useSessionsMock.mockReturnValue( { data: [], isLoading: false } );
		useConnectorMock.mockReturnValue( {
			openExternalUrl: vi.fn(),
			openSiteFolder: vi.fn(),
			openSiteInEditor: vi.fn(),
			openSiteInTerminal: vi.fn(),
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

	it( 'uses a play glyph for stopped site status and starts the site when clicked', () => {
		render( <SiteList /> );

		const stoppedButton = screen.getByRole( 'button', {
			name: 'Site status: Stopped. Start site',
		} );
		const statusGlyph = stoppedButton.querySelector( 'svg:first-of-type' );

		expect( statusGlyph ).toHaveAttribute( 'viewBox', '0 0 10 10' );
		expect( statusGlyph?.querySelector( 'path' ) ).toHaveAttribute( 'd', 'M2.5 1 L9 5 L2.5 9 Z' );
		expect( statusGlyph?.querySelector( 'rect' ) ).not.toBeInTheDocument();

		fireEvent.click( stoppedButton );

		expect( startSite ).toHaveBeenCalledWith( 'stopped-site' );
		expect( stopSite ).not.toHaveBeenCalled();
		expect( navigateMock ).not.toHaveBeenCalled();
	} );

	it( 'uses a pause glyph as the running site action', () => {
		render( <SiteList /> );

		const runningButton = screen.getByRole( 'button', {
			name: 'Site status: Running. Stop site',
		} );
		const actionGlyph = runningButton.querySelector( 'span[aria-hidden="true"]' );

		expect( runningButton.querySelectorAll( 'svg' ) ).toHaveLength( 1 );
		expect( actionGlyph?.querySelector( 'span' ) ).toBeInTheDocument();
	} );

	it( 'opens site actions from a row right-click without opening the latest chat', async () => {
		render( <SiteList /> );

		fireEvent.contextMenu( screen.getByText( 'Stopped Site' ) );

		expect( navigateMock ).not.toHaveBeenCalled();
		expect( await screen.findByText( 'Site settings' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Duplicate site' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Open folder' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Export entire site' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Delete site' ) ).toBeInTheDocument();
	} );

	it( 'opens site settings from the site actions menu', async () => {
		render( <SiteList /> );

		fireEvent.contextMenu( screen.getByText( 'Stopped Site' ) );
		fireEvent.click( await screen.findByText( 'Site settings' ) );

		expect( navigateMock ).toHaveBeenCalledTimes( 1 );
		expect( navigateMock ).toHaveBeenLastCalledWith( {
			to: '/sites/$siteId/overview',
			params: { siteId: 'stopped-site' },
			search: { tab: 'general' },
		} );
	} );

	it( 'opens the site overview when clicking a site while agentic features are unavailable', () => {
		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: false,
			chatEnabled: false,
			reason: 'signed-out',
			isReady: true,
		} );

		render( <SiteList /> );

		fireEvent.click( screen.getByText( 'Stopped Site' ) );

		expect( navigateMock ).toHaveBeenCalledTimes( 1 );
		expect( navigateMock ).toHaveBeenLastCalledWith( {
			to: '/sites/$siteId/overview',
			params: { siteId: 'stopped-site' },
		} );
	} );

	it( 'opens the site overview from the row gear without opening the latest chat', () => {
		render( <SiteList /> );

		fireEvent.click( screen.getAllByRole( 'button', { name: 'Site overview' } )[ 0 ] );

		expect( navigateMock ).toHaveBeenCalledTimes( 1 );
		expect( navigateMock ).toHaveBeenLastCalledWith( {
			to: '/sites/$siteId/overview',
			params: { siteId: 'stopped-site' },
		} );
	} );

	it( 'dims stopped site titles without dimming running sites', () => {
		render( <SiteList /> );

		const stoppedSiteClassName = screen.getByText( 'Stopped Site' ).getAttribute( 'class' ) ?? '';
		const runningSiteClassName = screen.getByText( 'Running Site' ).getAttribute( 'class' ) ?? '';

		expect( stoppedSiteClassName ).toContain( 'siteNameStopped' );
		expect( runningSiteClassName ).not.toContain( 'siteNameStopped' );
	} );

	it( 'replaces the status dot with the Xdebug glyph on the Xdebug-enabled site', () => {
		useSitesMock.mockReturnValue( {
			data: [
				createSite( {
					id: 'xdebug-site',
					name: 'Xdebug Site',
					path: '/Users/example/Studio/xdebug-site',
					running: true,
					enableXdebug: true,
				} ),
				createSite( {
					id: 'plain-site',
					name: 'Plain Site',
					path: '/Users/example/Studio/plain-site',
					running: true,
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList /> );

		const xdebugButton = screen.getByRole( 'button', {
			name: 'Site status: Running. Xdebug enabled. Stop site',
		} );
		const xdebugGlyph = xdebugButton.querySelector( 'svg:first-of-type' );
		const plainButton = screen.getByRole( 'button', {
			name: 'Site status: Running. Stop site',
		} );

		expect( xdebugGlyph ).toHaveAttribute( 'viewBox', '0 0 24 24' );
		expect( xdebugGlyph?.querySelector( 'rect' ) ).not.toBeInTheDocument();
		expect( plainButton ).not.toHaveAttribute( 'data-xdebug' );
		expect( plainButton.querySelector( 'svg:first-of-type rect' ) ).toBeInTheDocument();

		fireEvent.click( xdebugButton );
		expect( stopSite ).toHaveBeenCalledWith( 'xdebug-site' );
	} );

	it( 'keeps the greyed Xdebug glyph visible while the site is stopped', () => {
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

		const button = screen.getByRole( 'button', {
			name: 'Site status: Stopped. Xdebug enabled. Start site',
		} );

		// The stopped-row CSS hides the status button unless `data-xdebug` is
		// set alongside `data-state`; assert that DOM contract.
		expect( button ).toHaveAttribute( 'data-state', 'stopped' );
		expect( button ).toHaveAttribute( 'data-xdebug' );
		expect( button.querySelector( 'svg:first-of-type' ) ).toHaveAttribute( 'viewBox', '0 0 24 24' );
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

	it( 'marks the site row as contextual on the site overview route', () => {
		paramsMock = { siteId: 'stopped-site' };
		pathnameMock = '/sites/stopped-site/overview';

		render( <SiteList /> );

		const stoppedRow = screen.getByText( 'Stopped Site' ).closest( 'section' )!;
		const siteButton = within( stoppedRow ).getByRole( 'button', { name: 'Stopped Site' } );

		expect( siteButton ).not.toHaveAttribute( 'aria-current' );
		expect( stoppedRow.getAttribute( 'class' ) ?? '' ).toContain( 'siteContextActive' );
	} );

	it( 'opens the latest active chat when a site is clicked', () => {
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

		render( <SiteList /> );

		expect( screen.queryByText( 'Latest visible chat' ) ).not.toBeInTheDocument();

		const stoppedRow = screen.getByText( 'Stopped Site' ).closest( 'header' );
		expect( stoppedRow ).toBeInTheDocument();

		fireEvent.click( stoppedRow! );

		expect( navigateMock ).toHaveBeenCalledWith( {
			to: '/sessions/$sessionId',
			params: { sessionId: 'latest-chat' },
		} );
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

	it( 'shows a new message indicator when an inactive site chat updates', () => {
		let sessions = [
			createSession( {
				id: 'stopped-chat',
				ownerSitePath: '/Users/example/Studio/stopped-site',
				updatedAt: '2026-06-20T12:00:00.000Z',
			} ),
		];
		useSessionsMock.mockImplementation( () => ( {
			data: sessions,
			isLoading: false,
		} ) );

		const { rerender } = render( <SiteList /> );

		expect( screen.queryByRole( 'status', { name: 'New message' } ) ).not.toBeInTheDocument();

		sessions = [
			createSession( {
				id: 'stopped-chat',
				ownerSitePath: '/Users/example/Studio/stopped-site',
				updatedAt: '2026-06-20T12:01:00.000Z',
			} ),
		];
		rerender( <SiteList /> );

		const indicator = screen.getByRole( 'status', { name: 'New message' } );
		const siteName = screen.getByText( 'Stopped Site' );

		expect( indicator ).toBeInTheDocument();
		expect( indicator.compareDocumentPosition( siteName ) & Node.DOCUMENT_POSITION_FOLLOWING ).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
	} );

	it( 'does not show a new message indicator for the open chat', () => {
		paramsMock = { sessionId: 'stopped-chat' };
		pathnameMock = '/sessions/stopped-chat';
		let sessions = [
			createSession( {
				id: 'stopped-chat',
				ownerSitePath: '/Users/example/Studio/stopped-site',
				updatedAt: '2026-06-20T12:00:00.000Z',
			} ),
		];
		useSessionsMock.mockImplementation( () => ( {
			data: sessions,
			isLoading: false,
		} ) );

		const { rerender } = render( <SiteList /> );

		sessions = [
			createSession( {
				id: 'stopped-chat',
				ownerSitePath: '/Users/example/Studio/stopped-site',
				updatedAt: '2026-06-20T12:01:00.000Z',
			} ),
		];
		rerender( <SiteList /> );

		expect( screen.queryByRole( 'status', { name: 'New message' } ) ).not.toBeInTheDocument();
	} );

	it( 'shows a new message indicator while only the site settings are open', () => {
		// Settings don't show the chat, so an update there is still unseen.
		paramsMock = { siteId: 'stopped-site' };
		pathnameMock = '/sites/stopped-site/settings';
		let sessions = [
			createSession( {
				id: 'stopped-chat',
				ownerSitePath: '/Users/example/Studio/stopped-site',
				updatedAt: '2026-06-20T12:00:00.000Z',
			} ),
		];
		useSessionsMock.mockImplementation( () => ( {
			data: sessions,
			isLoading: false,
		} ) );

		const { rerender } = render( <SiteList /> );

		sessions = [
			createSession( {
				id: 'stopped-chat',
				ownerSitePath: '/Users/example/Studio/stopped-site',
				updatedAt: '2026-06-20T12:01:00.000Z',
			} ),
		];
		rerender( <SiteList /> );

		expect( screen.getByRole( 'status', { name: 'New message' } ) ).toBeInTheDocument();
	} );

	it( 'names the configured editor and terminal in the site actions', async () => {
		const openSiteInEditor = vi.fn( () => Promise.resolve() );
		useConnectorMock.mockReturnValue( {
			openExternalUrl: vi.fn(),
			openSiteFolder: vi.fn(),
			openSiteInEditor,
			openSiteInTerminal: vi.fn(),
		} as unknown as ReturnType< typeof useConnector > );
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
		expect( openSiteInEditor ).toHaveBeenCalledWith( 'stopped-site' );
	} );

	it( 'hides the editor and terminal actions when unset', async () => {
		useUserPreferencesMock.mockReturnValue( {
			data: {
				editor: null,
				terminal: null,
				colorScheme: 'system',
				locale: undefined,
				analyticsEnabled: true,
				defaultSiteDirectory: '',
				studioCliInstalled: false,
				studioCliExternallyManaged: false,
				agenticFeaturesEnabled: true,
			},
		} );

		render( <SiteList /> );

		fireEvent.contextMenu( screen.getByText( 'Stopped Site' ) );

		await screen.findByText( 'Open folder' );
		expect( screen.queryByText( /Open in / ) ).not.toBeInTheDocument();
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
