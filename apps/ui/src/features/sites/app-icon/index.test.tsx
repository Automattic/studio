import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppIcon } from '.';

const fallback = <span>fallback</span>;

describe( 'AppIcon', () => {
	it( 'shows the bundled logo, and the fallback for an app without one', () => {
		const { container, rerender } = render( <AppIcon app="vscode" fallback={ fallback } /> );
		expect( container.querySelector( 'img' ) ).toBeInTheDocument();

		rerender( <AppIcon app="zed" fallback={ fallback } /> );
		expect( screen.getByText( 'fallback' ) ).toBeInTheDocument();
	} );

	it( 'shows the fallback when the logo fails to load', () => {
		const { container } = render( <AppIcon app="phpmyadmin" fallback={ fallback } /> );
		fireEvent.error( container.querySelector( 'img' )! );
		expect( screen.getByText( 'fallback' ) ).toBeInTheDocument();
	} );
} );
