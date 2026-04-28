import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isRemoteSessionEnabled } from 'cli/lib/feature-flags';

describe( 'isRemoteSessionEnabled', () => {
	const originalValue = process.env.STUDIO_ENABLE_REMOTE_SESSION;

	beforeEach( () => {
		delete process.env.STUDIO_ENABLE_REMOTE_SESSION;
	} );

	afterEach( () => {
		if ( originalValue === undefined ) {
			delete process.env.STUDIO_ENABLE_REMOTE_SESSION;
		} else {
			process.env.STUDIO_ENABLE_REMOTE_SESSION = originalValue;
		}
	} );

	it( 'returns false when the env var is unset', () => {
		expect( isRemoteSessionEnabled() ).toBe( false );
	} );

	it( 'returns true only for the literal string "true"', () => {
		process.env.STUDIO_ENABLE_REMOTE_SESSION = 'true';
		expect( isRemoteSessionEnabled() ).toBe( true );
	} );

	it.each( [ '1', 'TRUE', 'yes', 'on', '' ] )(
		'returns false for non-canonical truthy-looking values: %s',
		( value ) => {
			process.env.STUDIO_ENABLE_REMOTE_SESSION = value;
			expect( isRemoteSessionEnabled() ).toBe( false );
		}
	);
} );
