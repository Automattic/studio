import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRemoteModeEnabled } from '../remote-mode-flag';

describe( 'isRemoteModeEnabled', () => {
	afterEach( () => {
		vi.unstubAllEnvs();
	} );

	it( 'is off unless STUDIO_ENABLE_REMOTE_MODE is set', () => {
		vi.stubEnv( 'STUDIO_ENABLE_REMOTE_MODE', '' );
		expect( isRemoteModeEnabled() ).toBe( false );

		vi.stubEnv( 'STUDIO_ENABLE_REMOTE_MODE', '1' );
		expect( isRemoteModeEnabled() ).toBe( true );
	} );
} );
