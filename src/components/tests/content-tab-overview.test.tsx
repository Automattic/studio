// To run tests, execute `npm run test -- src/components/tests/content-tab-overview.test.tsx` from the root directory
import { render, screen } from '@testing-library/react';
import { useThemeDetails } from '../../hooks/use-theme-details';
import { ContentTabOverview } from '../content-tab-overview';

jest.mock( '../../hooks/use-theme-details' );

const runningSite: StartedSiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	running: true,
	id: 'site-id',
	url: 'http://example.com',
};

const notRunningSite: SiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
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
			details: {
				isBlockTheme,
				supportsWidgets,
				supportsMenus,
			},
			loading: false,
		} );
		render( <ContentTabOverview selectedSite={ selectedSite } /> );
	};

	describe( 'with block theme', () => {
		test( 'renders all relevant "Customize" buttons for block themes', () => {
			renderWithThemeDetails( { isBlockTheme: true } );

			blockThemeButtonLabels.forEach( ( label ) => {
				expect( screen.getByText( label ) ).toBeEnabled();
			} );

			// Assert that buttons intended for use with classic themes are not rendered
			expect( screen.queryByText( 'Customizer' ) ).not.toBeInTheDocument();
			expect( screen.queryByText( 'Menus' ) ).not.toBeInTheDocument();
			expect( screen.queryByText( 'Widgets' ) ).not.toBeInTheDocument();
		} );

		test( '"Customize" buttons are disabled when the server is not running', () => {
			renderWithThemeDetails( { isBlockTheme: true, selectedSite: notRunningSite } );

			blockThemeButtonLabels.forEach( ( label ) => {
				const button = screen.getByText( label );
				expect( button ).toBeDisabled();
			} );
		} );
	} );

	describe( 'with classic theme', () => {
		describe( 'without widget support', () => {
			test( 'renders only Customizer and Menus buttons', () => {
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

			test( '"Customize" buttons are disabled when the server is not running', () => {
				renderWithThemeDetails( {
					isBlockTheme: false,
					supportsWidgets: true,
					supportsMenus: true,
					selectedSite: notRunningSite,
				} );

				expect( screen.getByText( 'Customizer' ) ).toBeDisabled();
				expect( screen.getByText( 'Menus' ) ).toBeDisabled();
				expect( screen.getByText( 'Widgets' ) ).toBeDisabled();
			} );
		} );
	} );
} );
