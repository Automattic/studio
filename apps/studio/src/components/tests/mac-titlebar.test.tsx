import { render } from '@testing-library/react';
import { vi } from 'vitest';
import MacTitlebar from 'src/components/mac-titlebar';
import { useFullscreen } from 'src/hooks/use-fullscreen';
import { isWindowFrameRtl } from 'src/lib/is-window-frame-rtl';

vi.mock( 'src/hooks/use-fullscreen' );
vi.mock( 'src/lib/is-window-frame-rtl' );

const FULLSCREEN_CLASSES = {
	ltr: 'ltr:pl-4',
	rtl: 'rtl:pr-4',
} as const;

// In fullscreen mode, no extra padding classes are applied (traffic lights are hidden)

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
		vi.clearAllMocks();
		vi.mocked( useFullscreen ).mockReturnValue( false );
		vi.mocked( isWindowFrameRtl ).mockReturnValue( false );
	} );

	it( 'should render with correct padding in non-fullscreen LTR mode', () => {
		vi.mocked( useFullscreen ).mockReturnValue( false );
		vi.mocked( isWindowFrameRtl ).mockReturnValue( false );

		const { container } = render( <MacTitlebar /> );
		const titlebar = container.firstChild;

		expect( titlebar ).toHaveClass( NON_FULLSCREEN_CLASSES.ltr.normal );
		expect( titlebar ).toHaveClass( NON_FULLSCREEN_CLASSES.ltr.chrome );
		expect( titlebar ).not.toHaveClass( FULLSCREEN_CLASSES.ltr );
		expect( titlebar ).not.toHaveClass( FULLSCREEN_CLASSES.rtl );
	} );

	it( 'should render with correct padding in non-fullscreen RTL mode', () => {
		vi.mocked( useFullscreen ).mockReturnValue( false );
		vi.mocked( isWindowFrameRtl ).mockReturnValue( true );

		const { container } = render( <MacTitlebar /> );
		const titlebar = container.firstChild;

		expect( titlebar ).toHaveClass( NON_FULLSCREEN_CLASSES.rtl.normal );
		expect( titlebar ).not.toHaveClass( FULLSCREEN_CLASSES.ltr );
		expect( titlebar ).not.toHaveClass( FULLSCREEN_CLASSES.rtl );
	} );

	it( 'should render with no extra padding in fullscreen mode', () => {
		vi.mocked( useFullscreen ).mockReturnValue( true );

		const { container } = render( <MacTitlebar /> );
		const titlebar = container.firstChild;

		expect( titlebar ).not.toHaveClass( FULLSCREEN_CLASSES.ltr );
		expect( titlebar ).not.toHaveClass( FULLSCREEN_CLASSES.rtl );
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
