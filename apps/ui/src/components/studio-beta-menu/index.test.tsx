import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAppGlobals } from '@/data/queries/use-app-globals';
import { REPORT_ISSUE_URL } from '@/lib/docs-links';
import { StudioBetaMenu } from './index';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-app-globals', () => ( {
	useAppGlobals: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const useAppGlobalsMock = vi.mocked( useAppGlobals, { partial: true } );

describe( 'StudioBetaMenu', () => {
	const disableAgenticUi = vi.fn().mockResolvedValue( undefined );
	const openExternalUrl = vi.fn().mockResolvedValue( undefined );

	beforeEach( () => {
		vi.clearAllMocks();
		useConnectorMock.mockReturnValue( {
			capabilities: { switchToClassicUi: true },
			disableAgenticUi,
			openExternalUrl,
		} as never );
		useAppGlobalsMock.mockReturnValue( {
			data: { platform: 'darwin', isWindowsStore: false, appVersion: '1.18.0-beta1' },
		} as never );
	} );

	it( 'offers feedback and classic Studio actions from its menu', async () => {
		render( <StudioBetaMenu /> );

		expect( screen.queryByRole( 'menuitem', { name: 'Report an issue' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Studio Beta options' } ) );
		expect( await screen.findByText( 'Studio 1.18.0-beta1' ) ).toBeVisible();

		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Switch to classic' } ) );
		expect( disableAgenticUi ).toHaveBeenCalledTimes( 1 );

		fireEvent.click( screen.getByRole( 'button', { name: 'Studio Beta options' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Report an issue' } ) );
		expect( openExternalUrl ).toHaveBeenCalledWith( REPORT_ISSUE_URL );
	} );

	it( 'hides the classic action when the host cannot switch experiences', async () => {
		useConnectorMock.mockReturnValue( {
			capabilities: { switchToClassicUi: false },
			disableAgenticUi,
			openExternalUrl,
		} as never );

		render( <StudioBetaMenu /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Studio Beta options' } ) );

		expect( await screen.findByRole( 'menuitem', { name: 'Report an issue' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'menuitem', { name: 'Switch to classic' } )
		).not.toBeInTheDocument();
	} );

	// Browser targets report no installed app version; the menu drops the row
	// rather than rendering a bare "Studio".
	it( 'omits the version row when the host reports no app version', async () => {
		useAppGlobalsMock.mockReturnValue( {
			data: { platform: 'browser', isWindowsStore: false },
		} as never );

		render( <StudioBetaMenu /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Studio Beta options' } ) );

		expect( await screen.findByRole( 'menuitem', { name: 'Report an issue' } ) ).toBeVisible();
		expect( screen.queryByText( /^Studio / ) ).not.toBeInTheDocument();
	} );
} );
