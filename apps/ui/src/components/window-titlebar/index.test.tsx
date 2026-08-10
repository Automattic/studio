import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WindowTitlebar } from './index';

vi.mock( '@/hooks/use-color-scheme', () => ( { useColorScheme: () => 'dark' } ) );

function stubWindowControlsOverlay( height: number ) {
	Object.defineProperty( navigator, 'windowControlsOverlay', {
		configurable: true,
		value: {
			visible: true,
			getTitlebarAreaRect: () => ( { x: 0, right: window.innerWidth - 138, height } ),
			addEventListener: () => {},
			removeEventListener: () => {},
		},
	} );
}

describe( 'WindowTitlebar', () => {
	afterEach( () => {
		delete ( navigator as Navigator & { windowControlsOverlay?: unknown } ).windowControlsOverlay;
		document.documentElement.style.removeProperty( '--app-titlebar-height' );
	} );

	it( 'reserves nothing when there is no overlay', () => {
		const { container } = render( <WindowTitlebar /> );
		expect( container ).toBeEmptyDOMElement();
		expect( document.documentElement.style.getPropertyValue( '--app-titlebar-height' ) ).toBe(
			'0px'
		);
	} );

	it( 'reserves a band the height of the overlay so surfaces below can clear it', () => {
		stubWindowControlsOverlay( 44 );
		const { container } = render( <WindowTitlebar /> );
		expect( container.firstChild ).toBeInTheDocument();
		expect( document.documentElement.style.getPropertyValue( '--app-titlebar-height' ) ).toBe(
			'44px'
		);
	} );
} );
