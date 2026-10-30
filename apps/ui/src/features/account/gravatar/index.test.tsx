import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Gravatar } from './index';

describe( 'Gravatar', () => {
	it( 'shows a local fallback without an email', () => {
		const { container } = render( <Gravatar email="" /> );
		expect( container.querySelector( 'svg' ) ).toBeInTheDocument();
		expect( container.querySelector( 'img' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the fallback when the photo is unavailable and tries a new account photo', async () => {
		const { container, rerender } = render( <Gravatar email="first@example.test" /> );
		await waitFor( () => expect( container.querySelector( 'img' ) ).toBeInTheDocument() );
		const image = container.querySelector( 'img' )!;
		const firstUrl = image.src;
		expect( firstUrl ).toContain( '&d=404' );
		fireEvent.error( image );
		expect( container.querySelector( 'img' ) ).not.toBeInTheDocument();
		expect( container.querySelector( 'svg' ) ).toBeInTheDocument();

		rerender( <Gravatar email="second@example.test" /> );
		await waitFor( () => expect( container.querySelector( 'img' ) ).toBeInTheDocument() );
		expect( container.querySelector( 'img' )!.src ).not.toBe( firstUrl );
	} );
} );
