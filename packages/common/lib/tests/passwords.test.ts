// Removed: globals are now available via vitest/globals in tsconfig
import { createPassword, decodePassword, encodePassword } from '@studio/common/lib/passwords';

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

describe( 'encodePassword', () => {
	it( 'should encode the password to Base64', () => {
		const plainPassword = 'test-password';
		const encoded = encodePassword( plainPassword );
		expect( encoded ).toBe( btoa( plainPassword ) );
	} );

	it( 'should be reversible with decodePassword', () => {
		const plainPassword = 'my-secret-pass!123';
		const encoded = encodePassword( plainPassword );
		expect( decodePassword( encoded ) ).toBe( plainPassword );
	} );

	it( 'should handle Unicode characters (Cyrillic, Chinese, emoji)', () => {
		const unicodePassword = 'пароль密码🔐';
		const encoded = encodePassword( unicodePassword );
		expect( decodePassword( encoded ) ).toBe( unicodePassword );
	} );

	it( 'should handle mixed ASCII and Unicode', () => {
		const mixedPassword = 'admin123_пароль_密码';
		const encoded = encodePassword( mixedPassword );
		expect( decodePassword( encoded ) ).toBe( mixedPassword );
	} );
} );

describe( 'decodePassword', () => {
	it( 'should decode the password', () => {
		const mockPassword = 'test-password';
		expect( decodePassword( btoa( mockPassword ) ) ).toBe( mockPassword );
	} );
} );
