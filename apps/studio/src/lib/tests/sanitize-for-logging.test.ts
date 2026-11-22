import { sanitizeUnstructuredData } from 'src/lib/sanitize-for-logging';

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
