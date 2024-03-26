import { sanitizeForLogging, sanitizeUnstructuredData } from '../sanitize-for-logging';

describe( 'sanitizeForLogging', () => {
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
} );

describe( 'sanitizeUnstructuredData', () => {
	test( 'redacts sensitive data from the ends of strings', () => {
		const sanitized = sanitizeUnstructuredData( 'the quick brown auth secret key 123' );

		expect( sanitized ).toEqual( `the quick brown REDACTED
` );
	} );

	test( 'redacts multiline strings', () => {
		const sanitized = sanitizeUnstructuredData( `this line is safe
			this line has a password: secr3t
			this line is safe
			auth scrub this whole thing` );

		expect( sanitized ).toEqual( `this line is safe
			this line has a REDACTED
			this line is safe
			REDACTED
` );
	} );
} );
