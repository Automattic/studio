import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { useExpirationDate } from 'src/hooks/use-expiration-date';
import { recordRendererTracksEvent } from 'src/lib/analytics';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';
import { PreviewSiteRow } from '../preview-site-row';

vi.mock( 'src/lib/analytics', () => ( {
	recordRendererTracksEvent: vi.fn(),
} ) );

const mockOpenURL = vi.fn();
vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: vi.fn(),
} ) );

vi.mock( 'src/hooks/use-expiration-date', () => ( {
	useExpirationDate: vi.fn().mockReturnValue( {
		countDown: '5 days',
		isExpired: false,
		expireDateString: '2024-01-01',
		dateString: '2023-12-27',
	} ),
} ) );

vi.mock( 'src/hooks/use-format-localized-timestamps', () => ( {
	useFormatLocalizedTimestamps: vi.fn().mockReturnValue( {
		formatRelativeTime: vi.fn().mockReturnValue( '2 hours' ),
	} ),
} ) );

function renderWithProvider( component: React.ReactElement ) {
	return render( <Provider store={ store }>{ component }</Provider> );
}

describe( 'PreviewSiteRow', () => {
	const mockSnapshot = {
		atomicSiteId: 123,
		localSiteId: 'db30ac2b-1d8f-4df2-a171-1b9ea3bc149d',
		url: 'shad-of-cellos.wp.build',
		date: 123456789,
		name: 'Test Preview 1',
		sequence: 1,
	};

	const mockSelectedSite: StoppedSiteDetails = {
		id: '456',
		name: 'Test',
		path: '/test/path',
		phpVersion: '8.4',
		port: 9999,
		running: false,
	};

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( getIpcApi ).mockReturnValue( {
			openURL: mockOpenURL,
		} as unknown as ReturnType< typeof getIpcApi > );
	} );

	it( 'renders PreviewActionButtonsMenu when preview site is not expired', () => {
		renderWithProvider(
			<PreviewSiteRow
				snapshot={ mockSnapshot }
				selectedSite={ mockSelectedSite }
				disabledUpdate={ false }
			/>
		);

		expect( screen.getByRole( 'button', { name: 'Preview actions' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Clear' } ) ).not.toBeInTheDocument();
	} );

	it( 'renders Clear button instead of PreviewActionButtonsMenu when preview site is expired', () => {
		vi.mocked( useExpirationDate ).mockReturnValueOnce( {
			countDown: 'Expired',
			isExpired: true,
			expireDateString: '2023-12-27',
			dateString: '2023-12-27',
		} );

		renderWithProvider(
			<PreviewSiteRow
				snapshot={ mockSnapshot }
				selectedSite={ mockSelectedSite }
				disabledUpdate={ false }
			/>
		);

		expect( screen.queryByRole( 'button', { name: 'Preview actions' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Clear' } ) ).toBeInTheDocument();
	} );

	it( 'applies line-through style when preview site is expired', () => {
		vi.mocked( useExpirationDate ).mockReturnValueOnce( {
			countDown: 'Expired',
			isExpired: true,
			expireDateString: '2023-12-27',
			dateString: '2023-12-27',
		} );

		renderWithProvider(
			<PreviewSiteRow
				snapshot={ mockSnapshot }
				selectedSite={ mockSelectedSite }
				disabledUpdate={ false }
			/>
		);

		const siteName = screen.getByText( mockSnapshot.name );
		const siteUrl = screen.getByText( mockSnapshot.url );

		expect( siteName ).toHaveClass( 'line-through' );
		expect( siteUrl ).toHaveClass( 'line-through' );
	} );

	it( 'records a preview_site_open Tracks event and opens the URL when the link is clicked', async () => {
		const user = userEvent.setup();
		renderWithProvider(
			<PreviewSiteRow
				snapshot={ mockSnapshot }
				selectedSite={ mockSelectedSite }
				disabledUpdate={ false }
			/>
		);

		await user.click( screen.getByText( mockSnapshot.url ) );

		expect( recordRendererTracksEvent ).toHaveBeenCalledWith( TRACKS_EVENTS.PREVIEW_SITE_OPEN );
		expect( mockOpenURL ).toHaveBeenCalledWith( `https://${ mockSnapshot.url }` );
	} );
} );
