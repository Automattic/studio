import { describe, expect, it } from 'vitest';
import { resolveLaunchUiMode } from './use-ui-mode';

describe( 'resolveLaunchUiMode', () => {
	it( 'maps Studio 2 launch modes to the classic shell', () => {
		expect( resolveLaunchUiMode( 'studio2' ) ).toBe( 'classic' );
		expect( resolveLaunchUiMode( 'agentic' ) ).toBe( 'classic' );
		expect( resolveLaunchUiMode( 'desks' ) ).toBe( 'classic' );
	} );

	it( 'ignores missing and unknown launch modes', () => {
		expect( resolveLaunchUiMode( null ) ).toBeUndefined();
		expect( resolveLaunchUiMode( 'default' ) ).toBeUndefined();
		expect( resolveLaunchUiMode( 'bogus' ) ).toBeUndefined();
	} );
} );
