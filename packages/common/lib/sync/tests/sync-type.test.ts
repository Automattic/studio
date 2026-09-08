import { describe, expect, it } from 'vitest';
import { getSyncType } from '../sync-type';

describe( 'getSyncType', () => {
	it( 'reports Pressable sites', () => {
		expect( getSyncType( { isPressable: true } ) ).toBe( 'pressable' );
	} );

	it( 'reports WordPress.com sites', () => {
		expect( getSyncType( { isPressable: false } ) ).toBe( 'wpcom' );
	} );

	// The deep-link connect path builds a placeholder site with `isPressable`
	// hardcoded false, so callers pass `undefined` rather than let a fabricated
	// value masquerade as an observed one.
	it( 'reports `unknown` when the site is not available at emit time', () => {
		expect( getSyncType( undefined ) ).toBe( 'unknown' );
	} );
} );
