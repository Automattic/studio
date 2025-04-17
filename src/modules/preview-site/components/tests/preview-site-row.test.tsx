import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { useExpirationDate } from 'src/hooks/use-expiration-date';
import { store } from 'src/stores';
import { PreviewSiteRow } from '../preview-site-row';

jest.mock( 'src/hooks/use-snapshots', () => ( {
	useSnapshots: jest.fn().mockReturnValue( {
		removeSnapshot: jest.fn(),
		fetchSnapshotUsage: jest.fn(),
	} ),
} ) );

jest.mock( 'src/hooks/use-expiration-date', () => ( {
	useExpirationDate: jest.fn().mockReturnValue( {
		countDown: '5 days',
		isExpired: false,
	} ),
} ) );

jest.mock( 'src/hooks/use-format-localized-timestamps', () => ( {
	useFormatLocalizedTimestamps: jest.fn().mockReturnValue( {
		formatRelativeTime: jest.fn().mockReturnValue( '2 hours' ),
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
		phpVersion: '8.2',
		port: 9999,
		running: false,
	};

	beforeEach( () => {
		jest.clearAllMocks();
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
		( useExpirationDate as jest.Mock ).mockReturnValueOnce( {
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
		( useExpirationDate as jest.Mock ).mockReturnValueOnce( {
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
		const siteUrl = screen.getByText( `https://${ mockSnapshot.url }` );

		expect( siteName.className ).toContain( 'line-through' );
		expect( siteUrl.className ).toContain( 'line-through' );
	} );
} );
