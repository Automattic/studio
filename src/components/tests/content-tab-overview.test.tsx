// To run tests, execute `npm run test -- src/components/tests/content-tab-overview.test.tsx` from the root directory
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ContentTabOverview } from 'src/components/content-tab-overview';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useThemeDetails } from 'src/hooks/use-theme-details';
import { store } from 'src/stores';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';

jest.mock( 'src/lib/app-globals', () => ( {
	isWindows: jest.fn().mockReturnValue( false ),
} ) );
jest.mock( 'src/hooks/use-site-details' );
jest.mock( 'src/hooks/use-theme-details' );
jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: jest.fn().mockReturnValue( {
		getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
		getUserEditor: jest.fn().mockResolvedValue( 'vscode' ),
	} ),
} ) );

store.replaceReducer( testReducer );

const runningSite: StartedSiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	phpVersion: '8.3',
	running: true,
	id: 'site-id',
	url: 'http://example.com',
};

const notRunningSite: SiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	phpVersion: '8.3',
	running: false,
	id: 'site-id',
};

const blockThemeButtonLabels = [
	'Site Editor',
	'Styles',
	'Patterns',
	'Navigation',
	'Templates',
	'Pages',
];

describe( 'ContentTabOverview', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		( useSiteDetails as jest.Mock ).mockReturnValue( {} );
		store.dispatch( testActions.resetState() );
	} );

	const renderWithThemeDetails = ( {
		isBlockTheme,
		supportsWidgets,
		supportsMenus,
		selectedSite = runningSite,
	}: {
		isBlockTheme: boolean;
		supportsWidgets?: boolean;
		supportsMenus?: boolean;
		selectedSite?: SiteDetails;
	} ) => {
		( useThemeDetails as jest.Mock ).mockReturnValue( {
			selectedThemeDetails: {
				isBlockTheme,
				supportsWidgets,
				supportsMenus,
			},
			selectedLoadingThemeDetails: false,
		} );
		render(
			<Provider store={ store }>
				<ContentTabsProvider>
					<ContentTabOverview selectedSite={ selectedSite } />
				</ContentTabsProvider>
			</Provider>
		);
	};

	describe( 'with block theme', () => {
		test( 'renders all relevant "Customize" buttons for block themes', () => {
			( useSiteDetails as jest.Mock ).mockReturnValue( {
				loadingServer: { 'site-id': false },
			} );

			renderWithThemeDetails( { isBlockTheme: true } );

			blockThemeButtonLabels.forEach( ( label ) => {
				expect( screen.getByText( label ) ).toBeEnabled();
			} );

			// Assert that buttons intended for use with classic themes are not rendered
			expect( screen.queryByText( 'Customizer' ) ).not.toBeInTheDocument();
			expect( screen.queryByText( 'Menus' ) ).not.toBeInTheDocument();
			expect( screen.queryByText( 'Widgets' ) ).not.toBeInTheDocument();
		} );

		test( '"Customize" buttons are disabled when the server is starting', () => {
			( useSiteDetails as jest.Mock ).mockReturnValue( {
				selectedSite: { id: 'site-id' },
				loadingServer: { 'site-id': true },
			} );

			renderWithThemeDetails( { isBlockTheme: true, selectedSite: notRunningSite } );

			blockThemeButtonLabels.forEach( ( label ) => {
				const button = screen.getByRole( 'button', { name: label } );
				expect( button ).toBeDisabled();
			} );
		} );
	} );

	describe( 'with classic theme', () => {
		describe( 'without widget support', () => {
			test( 'renders only Customizer and Menus buttons', () => {
				( useSiteDetails as jest.Mock ).mockReturnValue( {
					loadingServer: { 'site-id': false },
				} );

				renderWithThemeDetails( {
					isBlockTheme: false,
					supportsWidgets: false,
					supportsMenus: true,
				} );

				expect( screen.getByText( 'Customizer' ) ).toBeEnabled();
				expect( screen.getByText( 'Menus' ) ).toBeEnabled();
				expect( screen.queryByText( 'Widgets' ) ).not.toBeInTheDocument();

				// Assert that buttons intended for use with block themes are not rendered
				blockThemeButtonLabels.forEach( ( label ) => {
					expect( screen.queryByText( label ) ).not.toBeInTheDocument();
				} );
			} );
		} );

		describe( 'without menu support', () => {
			test( 'renders only Customizer and Widgets buttons', () => {
				( useSiteDetails as jest.Mock ).mockReturnValue( {
					loadingServer: { 'site-id': false },
				} );

				renderWithThemeDetails( {
					isBlockTheme: false,
					supportsWidgets: true,
					supportsMenus: false,
				} );

				expect( screen.getByText( 'Customizer' ) ).toBeEnabled();
				expect( screen.getByText( 'Widgets' ) ).toBeEnabled();
				expect( screen.queryByText( 'Menus' ) ).not.toBeInTheDocument();

				// Assert that buttons intended for use with block themes are not rendered
				blockThemeButtonLabels.forEach( ( label ) => {
					expect( screen.queryByText( label ) ).not.toBeInTheDocument();
				} );
			} );
		} );

		describe( 'with both widget and menu support', () => {
			test( 'renders Customizer, Menus, and Widgets buttons', () => {
				( useSiteDetails as jest.Mock ).mockReturnValue( {
					loadingServer: { 'site-id': false },
				} );

				renderWithThemeDetails( {
					isBlockTheme: false,
					supportsWidgets: true,
					supportsMenus: true,
				} );

				expect( screen.getByText( 'Customizer' ) ).toBeEnabled();
				expect( screen.getByText( 'Menus' ) ).toBeEnabled();
				expect( screen.getByText( 'Widgets' ) ).toBeEnabled();

				// Assert that buttons intended for use with block themes are not rendered
				blockThemeButtonLabels.forEach( ( label ) => {
					expect( screen.queryByText( label ) ).not.toBeInTheDocument();
				} );
			} );

			test( '"Customize" buttons are disabled when the server is starting', () => {
				( useSiteDetails as jest.Mock ).mockReturnValue( {
					selectedSite: { id: 'site-id' },
					loadingServer: { 'site-id': true },
				} );

				renderWithThemeDetails( {
					isBlockTheme: false,
					supportsWidgets: true,
					supportsMenus: true,
					selectedSite: notRunningSite,
				} );

				expect( screen.getByRole( 'button', { name: 'Customizer' } ) ).toBeDisabled();
				expect( screen.getByRole( 'button', { name: 'Menus' } ) ).toBeDisabled();
				expect( screen.getByRole( 'button', { name: 'Widgets' } ) ).toBeDisabled();
			} );
		} );
	} );
} );
