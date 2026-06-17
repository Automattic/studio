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
} from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { SiteList } from './index';
import type { SiteDetails } from '@/data/core';
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

const useConnectorMock = vi.mocked( useConnector );
const useCopySiteMock = vi.mocked( useCopySite );
const useDeleteSiteMock = vi.mocked( useDeleteSite );
const useExportDatabaseMock = vi.mocked( useExportDatabase );
const useExportFullSiteMock = vi.mocked( useExportFullSite );
const useIsSessionRunningMock = vi.mocked( useIsSessionRunning );
const useSessionHasPendingQuestionMock = vi.mocked( useSessionHasPendingQuestion );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useSessionsMock = vi.mocked( useSessions );
const useSitesMock = vi.mocked( useSites );
const useStartSiteMock = vi.mocked( useStartSite );
const useStopSiteMock = vi.mocked( useStopSite );
const useUpdateSessionMetadataMock = vi.mocked( useUpdateSessionMetadata );
const useUserPreferencesMock = vi.mocked( useUserPreferences );

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
		} as never );
		useCopySiteMock.mockReturnValue( { isPending: false, mutate: vi.fn() } as never );
		useDeleteSiteMock.mockReturnValue( { isPending: false, mutate: vi.fn() } as never );
		useExportDatabaseMock.mockReturnValue( { isPending: false, mutate: vi.fn() } as never );
		useExportFullSiteMock.mockReturnValue( { isPending: false, mutate: vi.fn() } as never );
		useIsSessionRunningMock.mockReturnValue( false );
		useSessionHasPendingQuestionMock.mockReturnValue( false );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
		useSessionsMock.mockReturnValue( { data: [], isLoading: false } as never );
		useStartSiteMock.mockReturnValue( { isPending: false, mutate: startSite } as never );
		useStopSiteMock.mockReturnValue( { isPending: false, mutate: stopSite } as never );
		useUpdateSessionMetadataMock.mockReturnValue( {
			isPending: false,
			mutate: vi.fn(),
		} as never );
		useUserPreferencesMock.mockReturnValue( { data: { editor: 'zed' } } as never );
		useSitesMock.mockReturnValue( {
			data: [
				createSite( { id: 'stopped-site', name: 'Stopped Site', running: false } ),
				createSite( { id: 'running-site', name: 'Running Site', running: true } ),
			],
			isLoading: false,
		} as never );
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
