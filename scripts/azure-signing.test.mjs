import { afterEach, describe, expect, it, vi } from 'vitest';
import azureSigning from './azure-signing.cjs';

const { isWindowsSigningRequested } = azureSigning;

describe( 'isWindowsSigningRequested', () => {
	afterEach( () => {
		vi.unstubAllEnvs();
	} );

	it.each( [ '1', 'true', 'TRUE', ' 1 ' ] )( 'is requested when the flag is "%s"', ( value ) => {
		vi.stubEnv( 'SIGN_WINDOWS_BUILD', value );

		expect( isWindowsSigningRequested() ).toBe( true );
	} );

	it.each( [ '', '0', 'false', 'yes' ] )( 'is not requested when the flag is "%s"', ( value ) => {
		vi.stubEnv( 'SIGN_WINDOWS_BUILD', value );

		expect( isWindowsSigningRequested() ).toBe( false );
	} );

	it( 'is not requested when the flag is unset', () => {
		vi.stubEnv( 'SIGN_WINDOWS_BUILD', undefined );

		expect( isWindowsSigningRequested() ).toBe( false );
	} );
} );
