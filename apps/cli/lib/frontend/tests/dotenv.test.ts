import { formatEnvFile } from '@studio/common/lib/site-frontend';
import { parseDotenv } from 'cli/lib/frontend/dotenv';

describe( 'parseDotenv', () => {
	it( 'parses plain, quoted and exported values', () => {
		expect(
			parseDotenv(
				[
					'# comment',
					'',
					'PLAIN=value',
					'export EXPORTED=yes',
					'SINGLE=\'a "b" c\'',
					'DOUBLE="line\\nbreak"',
					'BACKTICK=`x`',
					'SPACED = padded  ',
					'EMPTY=',
				].join( '\n' )
			)
		).toEqual( {
			PLAIN: 'value',
			EXPORTED: 'yes',
			SINGLE: 'a "b" c',
			DOUBLE: 'line\nbreak',
			BACKTICK: 'x',
			SPACED: 'padded',
			EMPTY: '',
		} );
	} );

	it( 'strips inline comments from unquoted values only', () => {
		expect( parseDotenv( 'A=one # note\nB="two # kept"\nC=three#four' ) ).toEqual( {
			A: 'one',
			B: 'two # kept',
			C: 'three#four',
		} );
	} );

	it( 'handles CRLF line endings and lets later keys win', () => {
		expect( parseDotenv( 'A=1\r\nA=2\r\n' ) ).toEqual( { A: '2' } );
	} );

	it( 'ignores lines that are not assignments', () => {
		expect( parseDotenv( 'not an assignment\n1BAD=x\nGOOD=y' ) ).toEqual( { GOOD: 'y' } );
	} );

	it( 'round-trips what formatEnvFile writes', () => {
		const env = {
			WORDPRESS_URL: 'http://localhost:8881',
			WORDPRESS_APPLICATION_PASSWORD: 'abcd efgh ijkl mnop',
			TRICKY: 'quote " backslash \\ hash # end',
		};
		expect( parseDotenv( formatEnvFile( env ) ) ).toEqual( env );
	} );
} );
