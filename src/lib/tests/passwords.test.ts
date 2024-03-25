import { safeStorage } from 'electron';
import { createPassword, decryptPassword } from '../passwords';

jest.mock( 'electron', () => ( {
	safeStorage: {
		encryptString: jest.fn( ( password: string ) => Buffer.from( password ) ),
		decryptString: jest.fn( ( buffer: Buffer ) => buffer.toString() ),
	},
} ) );

describe( 'createPassword', () => {
	it( 'should return a base64 string', () => {
		const password = createPassword();
		expect( password ).toMatch( /^[A-Za-z0-9+/=]+$/ );
	} );

	it( 'should return a different password each time', () => {
		const password1 = createPassword();
		const password2 = createPassword();
		expect( password1 ).not.toEqual( password2 );
	} );

	it( 'should return a password that can be decrypted', () => {
		const password = createPassword();
		expect( () => {
			decryptPassword( password );
		} ).not.toThrow();
	} );
} );

describe( 'decryptPassword', () => {
	it( 'should decrypt the password using safeStorage', () => {
		const password = createPassword();
		decryptPassword( password );
		expect( safeStorage.decryptString ).toHaveBeenCalledWith( Buffer.from( password, 'base64' ) );
	} );
} );
