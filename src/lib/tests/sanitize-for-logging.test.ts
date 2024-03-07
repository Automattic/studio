import { sanitizeForLogging } from '../sanitize-for-logging';

test( 'redacts sensitive strings from objects', () => {
	const sanitized = sanitizeForLogging( {
		number: 123,
		password: 'secr3t!',
		bool: true,
		nullVal: null,
		undefinedVal: undefined,
	} );

	expect( sanitized ).toEqual( {
		number: 123,
		password: 'REDACTED',
		bool: true,
		nullVal: null,
		undefinedVal: undefined,
	} );
} );

test( 'redacts sensitive strings from nested objects', () => {
	const sanitized = sanitizeForLogging( {
		s: 'a string',
		nested: {
			t: 'another string',
			password: 'secr3t!',
		},
	} );

	expect( sanitized ).toEqual( {
		s: 'a string',
		nested: {
			t: 'another string',
			password: 'REDACTED',
		},
	} );
} );

test( 'keys are sensitive even if they only partially match', () => {
	const sanitized = sanitizeForLogging( {
		userPassword: 'secr3t!',
		authToken: 'secr3t!',
		secretKey: 'secr3t!',
		safeValue: 113,
		userEmail: 'user@example.com',
	} );

	expect( sanitized ).toEqual( {
		userPassword: 'REDACTED',
		authToken: 'REDACTED',
		secretKey: 'REDACTED',
		safeValue: 113,
		userEmail: 'REDACTED',
	} );
} );
