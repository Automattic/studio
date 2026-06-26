import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessions } from '@/data/queries/use-sessions';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { SiteList } from './index';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

const navigateMock = vi.fn();
let paramsMock: { sessionId?: string; siteId?: string } = {};

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigateMock,
	useParams: () => paramsMock,
} ) );

vi.mock( '@/data/queries/use-sessions', () => ( {
	useSessions: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
	useSites: vi.fn(),
	useStartSite: vi.fn(),
	useStopSite: vi.fn(),
} ) );

const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useSessionsMock = vi.mocked( useSessions, { partial: true } );
const useSitesMock = vi.mocked( useSites, { partial: true } );
const useStartSiteMock = vi.mocked( useStartSite, { partial: true } );
const useStopSiteMock = vi.mocked( useStopSite, { partial: true } );

describe( 'SiteList', () => {
	const startSite = vi.fn();
	const stopSite = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		paramsMock = {};

		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
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

	it( 'opens the site overview from the site action button', () => {
		render( <SiteList /> );

		expect( screen.queryByRole( 'button', { name: 'New chat' } ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getAllByRole( 'button', { name: 'Site overview' } )[ 0 ] );

		expect( navigateMock ).toHaveBeenCalledWith( {
			to: '/sites/$siteId/overview',
			params: { siteId: 'stopped-site' },
		} );
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

		fireEvent.click( screen.getByRole( 'button', { name: 'Stopped Site' } ) );

		expect( navigateMock ).toHaveBeenCalledWith( {
			to: '/sessions/$sessionId',
			params: { sessionId: 'latest-chat' },
		} );
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
