import { fireEvent, render, screen, within } from '@testing-library/react';
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
const useUserPreferencesMock = vi.mocked( useUserPreferences, { partial: true } );

describe( 'SiteList', () => {
	const startSite = vi.fn();
	const stopSite = vi.fn();

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
				createSite( { id: 'stopped-site', name: 'Stopped Site', running: false } ),
				createSite( { id: 'running-site', name: 'Running Site', running: true } ),
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

	it( 'groups sessions by owner site id, falling back to path for legacy sessions', () => {
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
					firstPrompt: 'Matched by id',
					ownerSiteId: 'site-b',
					ownerSitePath: '/sites/site-a',
				} ),
				createSession( {
					id: 'legacy',
					firstPrompt: 'Matched by path',
					ownerSitePath: '/sites/site-a',
				} ),
				// A deleted site's id must not fall back to a path that now
				// belongs to another site.
				createSession( {
					id: 'orphan',
					firstPrompt: 'Dead site id',
					ownerSiteId: 'deleted-site',
					ownerSitePath: '/sites/site-a',
				} ),
			],
			isLoading: false,
		} );

		render( <SiteList /> );

		const siteA = screen.getByText( 'Site A' ).closest( 'section' )!;
		const siteB = screen.getByText( 'Site B' ).closest( 'section' )!;
		const unassigned = screen.getByText( 'Unassigned' ).closest( 'section' )!;

		expect( within( siteB ).getByText( 'Matched by id' ) ).toBeInTheDocument();
		expect( within( siteA ).getByText( 'Matched by path' ) ).toBeInTheDocument();
		expect( within( unassigned ).getByText( 'Dead site id' ) ).toBeInTheDocument();
	} );
} );

function createSession( overrides: Partial< AiSessionSummary > = {} ): AiSessionSummary {
	return {
		id: 'session-1',
		filePath: '/sessions/session-1.jsonl',
		createdAt: '2026-07-01T00:00:00.000Z',
		updatedAt: '2026-07-01T00:00:00.000Z',
		activeEnvironment: 'local',
		eventCount: 1,
		...overrides,
	};
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
