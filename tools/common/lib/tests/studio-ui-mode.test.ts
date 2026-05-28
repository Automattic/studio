import { describe, expect, it } from 'vitest';
import {
	assertSupportedStudioUiMode,
	normalizeStudioUiMode,
	STUDIO_UI_MODE_DEFAULT,
	STUDIO_UI_MODE_STUDIO2,
} from '../studio-ui-mode';

describe( 'normalizeStudioUiMode', () => {
	it.each( [
		[ 'default', STUDIO_UI_MODE_DEFAULT ],
		[ 'studio2', STUDIO_UI_MODE_STUDIO2 ],
		[ 'agentic', STUDIO_UI_MODE_STUDIO2 ],
		[ 'desks', STUDIO_UI_MODE_STUDIO2 ],
		[ 'bogus', STUDIO_UI_MODE_DEFAULT ],
		[ undefined, STUDIO_UI_MODE_DEFAULT ],
		[ null, STUDIO_UI_MODE_DEFAULT ],
	] )( 'normalizes %s to %s', ( input, expected ) => {
		expect( normalizeStudioUiMode( input ) ).toBe( expected );
	} );
} );

describe( 'assertSupportedStudioUiMode', () => {
	it.each( [ 'default', 'studio2', 'agentic', 'desks' ] )( 'accepts %s', ( input ) => {
		expect( () => assertSupportedStudioUiMode( input ) ).not.toThrow();
	} );

	it( 'rejects unknown modes', () => {
		expect( () => assertSupportedStudioUiMode( 'bogus' ) ).toThrow( 'Invalid Studio UI mode.' );
	} );
} );
