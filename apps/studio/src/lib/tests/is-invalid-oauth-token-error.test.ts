import { isInvalidTokenError } from '../is-invalid-oauth-token-error';

describe( 'isInvalidTokenError', () => {
	describe( 'valid invalid token errors', () => {
		it( 'should return true for invalid token error with additional fields', () => {
			const response = {
				error: 'invalid_token',
				message: 'The OAuth2 token is invalid.',
				code: 401,
			};

			expect( isInvalidTokenError( response ) ).toBe( true );
		} );

		it( 'should return true for invalid token error with no additional fields', () => {
			const response = {
				error: 'invalid_token',
			};

			expect( isInvalidTokenError( response ) ).toBe( true );
		} );
	} );

	describe( 'invalid responses', () => {
		it( 'should return false for different error types', () => {
			const response = {
				error: 'access_denied',
				message: 'Access denied.',
			};

			expect( isInvalidTokenError( response ) ).toBe( false );
		} );

		it( 'should return false for empty error field', () => {
			const response = {
				error: '',
			};

			expect( isInvalidTokenError( response ) ).toBe( false );
		} );

		it( 'should return false for numeric error field', () => {
			const response = {
				error: 401,
			};

			expect( isInvalidTokenError( response ) ).toBe( false );
		} );

		it( 'should return false for boolean error field', () => {
			const response = {
				error: true,
			};

			expect( isInvalidTokenError( response ) ).toBe( false );
		} );
	} );
} );
