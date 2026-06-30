import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSiteAgentActivity } from '@/data/queries/use-agent-run';
import { useSessions } from '@/data/queries/use-sessions';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
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

vi.mock( '@/data/queries/use-sessions', () => ( {
	useSessions: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-agent-run', () => ( {
	useSiteAgentActivity: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
	useSites: vi.fn(),
	useStartSite: vi.fn(),
	useStopSite: vi.fn(),
} ) );

vi.mock( '@/data/sync-activity', () => ( {
	useSiteSyncActivity: vi.fn(),
} ) );

const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useSiteAgentActivityMock = vi.mocked( useSiteAgentActivity );
const useSessionsMock = vi.mocked( useSessions, { partial: true } );
const useSitesMock = vi.mocked( useSites, { partial: true } );
const useStartSiteMock = vi.mocked( useStartSite, { partial: true } );
const useStopSiteMock = vi.mocked( useStopSite, { partial: true } );
const useSiteSyncActivityMock = vi.mocked( useSiteSyncActivity );
const SITE_ORDER_STORAGE_KEY = 'studio-ui-site-list-order-v1';

describe( 'SiteList', () => {
	const startSite = vi.fn();
	const stopSite = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		window.localStorage.clear();
		paramsMock = {};
		pathnameMock = '/';

		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
		useSiteAgentActivityMock.mockReturnValue( 'idle' );
		useSiteSyncActivityMock.mockReturnValue( null );
		useSessionsMock.mockReturnValue( { data: [], isLoading: false } );
		useStartSiteMock.mockReturnValue( { isPending: false, mutate: startSite } );
		useStopSiteMock.mockReturnValue( { isPending: false, mutate: stopSite } );
		useSitesMock.mockReturnValue( {
			data: [
				createSite( {
					id: 'stopped-site',
					name: 'Stopped Site',
					path: '/Users/example/Studio/stopped-site',
					running: false,
				} ),
				createSite( {
					id: 'running-site',
					name: 'Running Site',
					path: '/Users/example/Studio/running-site',
					running: true,
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

	it( 'dims stopped site titles without dimming running sites', () => {
		render( <SiteList /> );

		const stoppedSiteClassName = screen.getByText( 'Stopped Site' ).getAttribute( 'class' ) ?? '';
		const runningSiteClassName = screen.getByText( 'Running Site' ).getAttribute( 'class' ) ?? '';

		expect( stoppedSiteClassName ).toContain( 'siteNameStopped' );
		expect( runningSiteClassName ).not.toContain( 'siteNameStopped' );
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

	it( 'marks the site row as contextual on site settings routes', () => {
		paramsMock = { siteId: 'stopped-site' };
		pathnameMock = '/sites/stopped-site/settings';

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

	it( 'persists a manual site order after drag and drop', () => {
		render( <SiteList /> );

		const stoppedRow = document.querySelector( '[data-site-id="stopped-site"]' );
		const runningRow = document.querySelector( '[data-site-id="running-site"]' );

		expect( stoppedRow ).toBeInTheDocument();
		expect( runningRow ).toBeInTheDocument();
		vi.spyOn( stoppedRow!, 'getBoundingClientRect' ).mockReturnValue(
			createRect( {
				top: 0,
				left: 8,
				width: 272,
				height: 34,
			} )
		);
		vi.spyOn( runningRow!, 'getBoundingClientRect' ).mockReturnValue(
			createRect( {
				top: 35,
				left: 0,
				width: 0,
				height: 34,
			} )
		);

		fireEvent(
			stoppedRow!,
			createPointerEvent( 'pointerdown', {
				button: 0,
				clientX: 16,
				clientY: 10,
			} )
		);
		fireEvent( window, createPointerEvent( 'pointermove', { clientX: 16, clientY: 70 } ) );

		const placeholder = screen.getByTestId( 'site-drop-placeholder' );

		expect( placeholder ).toBeInTheDocument();
		expect( document.querySelector( '[data-site-id="stopped-site"]' ) ).not.toBeInTheDocument();
		expect( window.localStorage.getItem( SITE_ORDER_STORAGE_KEY ) ).toBeNull();

		fireEvent( window, createPointerEvent( 'pointerup', { clientX: 16, clientY: 70 } ) );

		const stoppedSite = screen.getByText( 'Stopped Site' );
		const runningSite = screen.getByText( 'Running Site' );

		expect(
			runningSite.compareDocumentPosition( stoppedSite ) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBe( Node.DOCUMENT_POSITION_FOLLOWING );
		expect( window.localStorage.getItem( SITE_ORDER_STORAGE_KEY ) ).toBe(
			JSON.stringify( [ 'running-site', 'stopped-site' ] )
		);
	} );

	it( 'animates other sites into the drop placeholder while dragging', () => {
		render( <SiteList /> );

		const stoppedRow = document.querySelector( '[data-site-id="stopped-site"]' );
		const runningRow = document.querySelector( '[data-site-id="running-site"]' );
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

	it( 'does not show a new message indicator for the active site', () => {
		paramsMock = { siteId: 'stopped-site' };
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
} );

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
