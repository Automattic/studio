import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SiteIcon } from './index';

describe( 'SiteIcon', () => {
	it( 'renders a seeded mesh gradient as the fallback icon', () => {
		render( <SiteIcon data-testid="site-icon" seed="Demo Site" /> );

		const icon = screen.getByTestId( 'site-icon' );

		expect( icon.style.getPropertyValue( '--site-icon-color-a' ) ).toMatch(
			/^hsl\(\d+ 88% 58%\)$/
		);
		expect( icon.style.getPropertyValue( '--site-icon-position-a' ) ).toMatch( /^\d+% \d+%$/ );
		expect( icon.querySelector( 'img' ) ).not.toBeInTheDocument();
		expect( icon.querySelector( 'svg' ) ).not.toBeInTheDocument();
	} );

	it( 'uses the configured site image when one is available', () => {
		render( <SiteIcon data-testid="site-icon" imageSrc="data:image/png;base64,site-icon" /> );

		const icon = screen.getByTestId( 'site-icon' );
		const image = icon.querySelector( 'img' );

		expect( image ).toHaveAttribute( 'src', 'data:image/png;base64,site-icon' );
		expect( icon.querySelector( 'svg' ) ).not.toBeInTheDocument();
	} );

	it( 'falls back to the mesh gradient when the configured image fails', () => {
		render( <SiteIcon data-testid="site-icon" imageSrc="data:image/png;base64,broken" /> );

		const icon = screen.getByTestId( 'site-icon' );
		fireEvent.error( icon.querySelector( 'img' )! );

		expect( icon.querySelector( 'img' ) ).not.toBeInTheDocument();
		expect( icon.style.getPropertyValue( '--site-icon-color-a' ) ).toMatch(
			/^hsl\(\d+ 88% 58%\)$/
		);
		expect( icon.querySelector( 'svg' ) ).not.toBeInTheDocument();
	} );
} );
