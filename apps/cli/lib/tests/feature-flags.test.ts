import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSiteRuntime, isRemoteSessionEnabled } from 'cli/lib/feature-flags';

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

describe( 'getSiteRuntime', () => {
	const originalValue = process.env.STUDIO_RUNTIME;

	beforeEach( () => {
		delete process.env.STUDIO_RUNTIME;
	} );

	afterEach( () => {
		if ( originalValue === undefined ) {
			delete process.env.STUDIO_RUNTIME;
		} else {
			process.env.STUDIO_RUNTIME = originalValue;
		}
	} );

	it( 'defaults to playground when the env var is unset', () => {
		expect( getSiteRuntime() ).toBe( 'playground' );
	} );

	it( 'returns native-php when STUDIO_RUNTIME=native-php', () => {
		process.env.STUDIO_RUNTIME = 'native-php';
		expect( getSiteRuntime() ).toBe( 'native-php' );
	} );

	it( 'falls back to playground for unknown values', () => {
		process.env.STUDIO_RUNTIME = 'nonsense';
		expect( getSiteRuntime() ).toBe( 'playground' );
	} );
} );
