import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useIsSessionRunning, useSessionHasPendingQuestion } from '@/data/queries/use-agent-run';
import { useSessions, useUpdateSessionMetadata } from '@/data/queries/use-sessions';
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
import { SiteList } from './index';
import type { AiSessionSummary, SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@tanstack/react-router', () => ( {
	Link: ( props: { children?: ReactNode } ) => <a>{ props.children }</a>,
	useNavigate: () => vi.fn(),
	useParams: () => ( {} ),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-agent-run', () => ( {
	useIsSessionRunning: vi.fn(),
	useSessionHasPendingQuestion: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sessions', () => ( {
	useSessions: vi.fn(),
	useUpdateSessionMetadata: vi.fn(),
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

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const useCopySiteMock = vi.mocked( useCopySite, { partial: true } );
const useDeleteSiteMock = vi.mocked( useDeleteSite, { partial: true } );
const useExportDatabaseMock = vi.mocked( useExportDatabase, { partial: true } );
const useExportFullSiteMock = vi.mocked( useExportFullSite, { partial: true } );
const useIsSessionRunningMock = vi.mocked( useIsSessionRunning );
const useSessionHasPendingQuestionMock = vi.mocked( useSessionHasPendingQuestion );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useSessionsMock = vi.mocked( useSessions, { partial: true } );
const useSitesMock = vi.mocked( useSites, { partial: true } );
const useStartSiteMock = vi.mocked( useStartSite, { partial: true } );
const useStopSiteMock = vi.mocked( useStopSite, { partial: true } );
const useUpdateSessionMetadataMock = vi.mocked( useUpdateSessionMetadata, { partial: true } );
const useUpdateSitesSortOrderMock = vi.mocked( useUpdateSitesSortOrder, { partial: true } );
const useUserPreferencesMock = vi.mocked( useUserPreferences, { partial: true } );

describe( 'SiteList', () => {
	const startSite = vi.fn();
	const stopSite = vi.fn();
	const updateSitesSortOrder = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();

		useConnectorMock.mockReturnValue( {
			openExternalUrl: vi.fn(),
			openSiteFolder: vi.fn(),
			openSiteInEditor: vi.fn(),
			openSiteInTerminal: vi.fn(),
		} );
		useCopySiteMock.mockReturnValue( { isPending: false, mutate: vi.fn() } );
		useDeleteSiteMock.mockReturnValue( { isPending: false, mutate: vi.fn() } );
		useExportDatabaseMock.mockReturnValue( { isPending: false, mutate: vi.fn() } );
		useExportFullSiteMock.mockReturnValue( { isPending: false, mutate: vi.fn() } );
		useIsSessionRunningMock.mockReturnValue( false );
		useSessionHasPendingQuestionMock.mockReturnValue( false );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
		useSessionsMock.mockReturnValue( { data: [], isLoading: false } );
		useStartSiteMock.mockReturnValue( { isPending: false, mutate: startSite } );
		useStopSiteMock.mockReturnValue( { isPending: false, mutate: stopSite } );
		useUpdateSessionMetadataMock.mockReturnValue( {
			isPending: false,
			mutate: vi.fn(),
		} );
		useUpdateSitesSortOrderMock.mockReturnValue( {
			isPending: false,
			mutate: updateSitesSortOrder,
		} );
		useUserPreferencesMock.mockReturnValue( {
			data: {
				editor: 'zed',
				terminal: 'terminal',
				colorScheme: 'system',
				locale: undefined,
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
	} );

	it( 'keeps a stop glyph as the running site action', () => {
		render( <SiteList /> );

		const runningButton = screen.getByRole( 'button', {
			name: 'Site status: Running. Stop site',
		} );
		const actionGlyph = runningButton.querySelector( 'svg:nth-of-type(2)' );

		expect( actionGlyph?.querySelector( 'rect' ) ).toHaveAttribute( 'width', '8' );
		expect( actionGlyph?.querySelector( 'path' ) ).not.toBeInTheDocument();
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
		dragStoppedSiteBelowRunningSite();

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

	it( 'aborts the drag without reordering on pointercancel', () => {
		render( <SiteList /> );
		dragStoppedSiteBelowRunningSite();

		expect( screen.getByTestId( 'drop-placeholder' ) ).toBeInTheDocument();

		fireEvent( window, createPointerEvent( 'pointercancel', { clientX: 16, clientY: 70 } ) );

		expect( screen.queryByTestId( 'drop-placeholder' ) ).not.toBeInTheDocument();
		expect( updateSitesSortOrder ).not.toHaveBeenCalled();

		const stoppedSite = screen.getByText( 'Stopped Site' );
		const runningSite = screen.getByText( 'Running Site' );

		expect(
			stoppedSite.compareDocumentPosition( runningSite ) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBe( Node.DOCUMENT_POSITION_FOLLOWING );
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

	it( 'does not start a drag from the session list or site actions', () => {
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( {
					id: 'stopped-chat',
					firstPrompt: 'Stopped site chat',
					ownerSitePath: '/Users/example/Studio/stopped-site',
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList /> );

		const sessionLabel = screen.getByText( 'Stopped site chat' );

		fireEvent(
			sessionLabel,
			createPointerEvent( 'pointerdown', { button: 0, clientX: 16, clientY: 10 } )
		);
		fireEvent( window, createPointerEvent( 'pointermove', { clientX: 16, clientY: 70 } ) );

		expect( screen.queryByTestId( 'drop-placeholder' ) ).not.toBeInTheDocument();

		fireEvent( window, createPointerEvent( 'pointerup', { clientX: 16, clientY: 70 } ) );

		expect( updateSitesSortOrder ).not.toHaveBeenCalled();
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

function dragStoppedSiteBelowRunningSite() {
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
}

function createPointerEvent(
	type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
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
