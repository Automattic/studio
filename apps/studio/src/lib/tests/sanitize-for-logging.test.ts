import { sanitizeUnstructuredData, sanitizeUserpath } from 'src/lib/sanitize-for-logging';

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

describe( 'sanitizeUserpath', () => {
	test( 'redacts userpath on macOS when environment is not development', () => {
		process.env.NODE_ENV = 'production';
		const sanitized = sanitizeUserpath( '/Users/username/Library' );

		expect( sanitized ).toEqual( '/Users/[REDACTED]/Library' );
	} );

	test( 'redacts userpath on Windows when environment is not development', () => {
		process.env.NODE_ENV = 'production';
		const sanitized = sanitizeUserpath( 'C:\\Users\\username\\AppData' );

		expect( sanitized ).toEqual( 'C:\\Users\\[REDACTED]\\AppData' );
	} );

	test( 'does nothing if path does not match', () => {
		const sanitized = sanitizeUserpath( 'not a valid userpath' );

		expect( sanitized ).toEqual( 'not a valid userpath' );
	} );
} );
