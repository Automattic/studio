import { SITE_RUNTIME_NATIVE_PHP, SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSiteRuntime } from 'cli/lib/feature-flags';

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

	it( 'defaults to native-php when the env var is unset', () => {
		expect( getSiteRuntime() ).toBe( SITE_RUNTIME_NATIVE_PHP );
	} );

	it( 'returns native-php when STUDIO_RUNTIME=native-php', () => {
		process.env.STUDIO_RUNTIME = SITE_RUNTIME_NATIVE_PHP;
		expect( getSiteRuntime() ).toBe( SITE_RUNTIME_NATIVE_PHP );
	} );

	it( 'returns playground when STUDIO_RUNTIME=playground', () => {
		process.env.STUDIO_RUNTIME = SITE_RUNTIME_PLAYGROUND;
		expect( getSiteRuntime() ).toBe( SITE_RUNTIME_PLAYGROUND );
	} );

	it( 'falls back to native-php for unknown values', () => {
		process.env.STUDIO_RUNTIME = 'nonsense';
		expect( getSiteRuntime() ).toBe( SITE_RUNTIME_NATIVE_PHP );
	} );
} );
