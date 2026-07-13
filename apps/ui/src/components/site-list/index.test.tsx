import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const { navigateMock, paramsMock } = vi.hoisted( () => ( {
	navigateMock: vi.fn(),
	paramsMock: vi.fn( (): Record< string, string | undefined > => ( {} ) ),
} ) );

vi.mock( '@tanstack/react-router', () => ( {
	Link: ( props: { children?: ReactNode } ) => <a>{ props.children }</a>,
	useNavigate: () => navigateMock,
	useParams: () => paramsMock(),
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

	describe( 'deleting a site', () => {
		// `mutate` stays inert: React Query drops its callbacks once the caller
		// unmounts, which is exactly what happens when the refreshed site list
		// removes the deleted row. Only the awaited `mutateAsync` result may
		// drive the redirect.
		const mutate = vi.fn();
		const mutateAsync = vi.fn();

		beforeEach( () => {
			mutateAsync.mockResolvedValue( undefined );
			useDeleteSiteMock.mockReturnValue( { isPending: false, mutate, mutateAsync } );
			useSessionsMock.mockReturnValue( {
				data: [
					createSession( { id: 'stopped-session', ownerSitePath: '/sites/stopped' } ),
					createSession( { id: 'running-session', ownerSitePath: '/sites/running' } ),
				],
				isLoading: false,
			} );
			useSitesMock.mockReturnValue( {
				data: [
					createSite( { id: 'stopped-site', name: 'Stopped Site', path: '/sites/stopped' } ),
					createSite( { id: 'running-site', name: 'Running Site', path: '/sites/running' } ),
				],
				isLoading: false,
			} );
		} );

		// Deletes the first site in the list ("Stopped Site") via its actions
		// menu, and waits for the confirmation dialog to close again.
		const confirmDeleteOfStoppedSite = async () => {
			render( <SiteList /> );
			fireEvent.click( screen.getAllByRole( 'button', { name: 'Site actions' } )[ 0 ] );
			fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Delete site' } ) );
			fireEvent.click( await screen.findByRole( 'button', { name: 'Delete site' } ) );
			await waitFor( () =>
				expect( screen.queryByRole( 'button', { name: 'Delete site' } ) ).not.toBeInTheDocument()
			);
		};

		it( 'redirects to the root when the open chat belongs to the deleted site', async () => {
			paramsMock.mockReturnValue( { sessionId: 'stopped-session' } );

			await confirmDeleteOfStoppedSite();

			expect( mutateAsync ).toHaveBeenCalledWith( { id: 'stopped-site', deleteFiles: true } );
			expect( navigateMock ).toHaveBeenCalledWith( { to: '/' } );
		} );

		it( 'stays put when the open chat belongs to another site', async () => {
			paramsMock.mockReturnValue( { sessionId: 'running-session' } );

			await confirmDeleteOfStoppedSite();

			expect( mutateAsync ).toHaveBeenCalled();
			expect( navigateMock ).not.toHaveBeenCalled();
		} );

		it( 'surfaces the failure and stays put when the delete fails', async () => {
			paramsMock.mockReturnValue( { sessionId: 'stopped-session' } );
			mutateAsync.mockRejectedValue( new Error( 'Site is busy' ) );

			render( <SiteList /> );
			fireEvent.click( screen.getAllByRole( 'button', { name: 'Site actions' } )[ 0 ] );
			fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Delete site' } ) );
			fireEvent.click( await screen.findByRole( 'button', { name: 'Delete site' } ) );

			expect( await screen.findByText( 'Site is busy' ) ).toBeInTheDocument();
			expect( navigateMock ).not.toHaveBeenCalled();
		} );
	} );
} );

function createSession( overrides: Partial< AiSessionSummary > = {} ): AiSessionSummary {
	return {
		id: 'session-1',
		filePath: '/sessions/session-1.jsonl',
		createdAt: '2026-07-13T00:00:00.000Z',
		updatedAt: '2026-07-13T00:00:00.000Z',
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
