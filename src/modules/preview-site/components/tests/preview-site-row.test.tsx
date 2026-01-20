import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { vi, type Mock } from 'vitest';
import { useExpirationDate } from 'src/hooks/use-expiration-date';
import { store } from 'src/stores';
import { PreviewSiteRow } from '../preview-site-row';

vi.mock( 'src/hooks/use-expiration-date', () => ( {
	useExpirationDate: vi.fn().mockReturnValue( {
		countDown: '5 days',
		isExpired: false,
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
		phpVersion: '8.3',
		port: 9999,
		running: false,
	};

	beforeEach( () => {
		vi.clearAllMocks();
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
		( useExpirationDate as Mock ).mockReturnValueOnce( {
			countDown: 'Expired',
			isExpired: true,
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
		( useExpirationDate as Mock ).mockReturnValueOnce( {
			countDown: 'Expired',
			isExpired: true,
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
} );
