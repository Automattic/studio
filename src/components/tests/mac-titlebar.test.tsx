import { render } from '@testing-library/react';
import { useFullscreen } from '../../hooks/use-fullscreen';
import { isWindowFrameRtl } from '../../lib/is-window-frame-rtl';
import MacTitlebar from '../mac-titlebar';

jest.mock( '../../hooks/use-fullscreen' );
jest.mock( '../../lib/is-window-frame-rtl' );

const FULLSCREEN_CLASSES = {
	ltr: 'ltr:pl-4',
	rtl: 'rtl:pr-4',
} as const;

const NON_FULLSCREEN_CLASSES = {
	ltr: {
		normal: 'ltr:pl-window-controls-width-mac',
		chrome: 'rtl:pl-window-controls-width-excl-chrome-mac rtl:pr-chrome',
	},
	rtl: {
		normal:
			'ltr:pr-window-controls-width-excl-chrome-mac ltr:pl-chrome rtl:pr-window-controls-width-mac rtl:-ml-chrome',
	},
} as const;

describe( 'MacTitlebar', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		( useFullscreen as jest.Mock ).mockReturnValue( false );
		( isWindowFrameRtl as jest.Mock ).mockReturnValue( false );
	} );

	it( 'should render with correct padding in non-fullscreen LTR mode', () => {
		( useFullscreen as jest.Mock ).mockReturnValue( false );
		( isWindowFrameRtl as jest.Mock ).mockReturnValue( false );

		const { container } = render( <MacTitlebar /> );
		const titlebar = container.firstChild;

		expect( titlebar ).toHaveClass( NON_FULLSCREEN_CLASSES.ltr.normal );
		expect( titlebar ).toHaveClass( NON_FULLSCREEN_CLASSES.ltr.chrome );
		expect( titlebar ).not.toHaveClass( FULLSCREEN_CLASSES.ltr );
		expect( titlebar ).not.toHaveClass( FULLSCREEN_CLASSES.rtl );
	} );

	it( 'should render with correct padding in non-fullscreen RTL mode', () => {
		( useFullscreen as jest.Mock ).mockReturnValue( false );
		( isWindowFrameRtl as jest.Mock ).mockReturnValue( true );

		const { container } = render( <MacTitlebar /> );
		const titlebar = container.firstChild;

		expect( titlebar ).toHaveClass( NON_FULLSCREEN_CLASSES.rtl.normal );
		expect( titlebar ).not.toHaveClass( FULLSCREEN_CLASSES.ltr );
		expect( titlebar ).not.toHaveClass( FULLSCREEN_CLASSES.rtl );
	} );

	it( 'should render with minimal padding in fullscreen mode', () => {
		( useFullscreen as jest.Mock ).mockReturnValue( true );

		const { container } = render( <MacTitlebar /> );
		const titlebar = container.firstChild;

		expect( titlebar ).toHaveClass( FULLSCREEN_CLASSES.ltr );
		expect( titlebar ).toHaveClass( FULLSCREEN_CLASSES.rtl );
		expect( titlebar ).not.toHaveClass( NON_FULLSCREEN_CLASSES.ltr.normal );
		expect( titlebar ).not.toHaveClass( NON_FULLSCREEN_CLASSES.rtl.normal );
	} );

	it( 'should render children', () => {
		const { getByText } = render( <MacTitlebar>Test Content</MacTitlebar> );
		expect( getByText( 'Test Content' ) ).toBeInTheDocument();
	} );

	it( 'should apply additional className if provided', () => {
		const { container } = render( <MacTitlebar className="custom-class" /> );
		const titlebar = container.firstChild;

		expect( titlebar ).toHaveClass( 'custom-class' );
	} );
} );
