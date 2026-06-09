import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SiteIcon } from './index';

describe( 'SiteIcon', () => {
	it( 'renders the image when a source is provided', () => {
		const { container } = render( <SiteIcon imageSrc="data:image/png;base64,AAAA" /> );
		const image = container.querySelector( 'img' );
		expect( image ).not.toBeNull();
		expect( image ).toHaveAttribute( 'src', 'data:image/png;base64,AAAA' );
	} );

	it( 'falls back to the gradient when the image fails to load', () => {
		const { container } = render( <SiteIcon imageSrc="data:image/png;base64,AAAA" /> );
		fireEvent.error( container.querySelector( 'img' )! );
		expect( container.querySelector( 'img' ) ).toBeNull();
	} );

	it( 'retries when the source changes after a previous failure', () => {
		const { container, rerender } = render( <SiteIcon imageSrc="data:image/png;base64,AAAA" /> );
		fireEvent.error( container.querySelector( 'img' )! );
		expect( container.querySelector( 'img' ) ).toBeNull();

		rerender( <SiteIcon imageSrc="data:image/png;base64,BBBB" /> );
		const image = container.querySelector( 'img' );
		expect( image ).not.toBeNull();
		expect( image ).toHaveAttribute( 'src', 'data:image/png;base64,BBBB' );
	} );

	it( 'renders the gradient when no source is provided', () => {
		const { container } = render( <SiteIcon seed="example" /> );
		expect( container.querySelector( 'img' ) ).toBeNull();
	} );
} );
