/**
 * @jest-environment node
 */
import { createPassword, decodePassword } from '../passwords';

describe( 'createPassword', () => {
	it( 'should return a Base64-encoded string', () => {
		const password = createPassword();
		expect( password ).toMatch( /^[A-Za-z0-9+/=]+$/ );
	} );

	it( 'should return a different password each time', () => {
		const password1 = createPassword();
		const password2 = createPassword();
		expect( password1 ).not.toEqual( password2 );
	} );
} );

describe( 'decodePassword', () => {
	it( 'should decode the password', () => {
		const mockPassword = 'test-password';
		expect( decodePassword( btoa( mockPassword ) ) ).toBe( mockPassword );
	} );
} );
