import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressiveBlur } from './index';

describe( 'ProgressiveBlur', () => {
	// The four blur layers paint nothing once `backdrop-filter` is off, leaving the
	// surface fade as the only thing keeping content from showing through. It has to
	// be in the DOM even when a caller doesn't opt in — CSS decides whether it is
	// visible — so making it conditional again would silently drop the fallback.
	it.each( [ true, false ] )( 'renders the surface fade when fadeToSurface=%s', ( fade ) => {
		const { container } = render( <ProgressiveBlur direction="down" fadeToSurface={ fade } /> );

		expect( container.querySelectorAll( 'span' ) ).toHaveLength( 5 );
	} );
} );
