import { escapeSingleQuotes } from 'src/about-menu/open-about-menu';

describe( 'escapeSingleQuotes', () => {
	it( 'should escape single quotes in a string', () => {
		const input = "Don't worry about 'it";
		const expected = "Don\\'t worry about \\'it";
		expect( escapeSingleQuotes( input ) ).toBe( expected );
	} );

	it( 'should handle strings with no single quotes', () => {
		const input = 'This string has no single quotes';
		const expected = 'This string has no single quotes';
		expect( escapeSingleQuotes( input ) ).toBe( expected );
	} );

	it( 'should handle empty string', () => {
		const input = '';
		const expected = '';
		expect( escapeSingleQuotes( input ) ).toBe( expected );
	} );

	it( 'should handle Windows path with single quotes', () => {
		const input = "it's just C:\\Users\\O'Reilly\\docs\\.";
		const expected = "it\\'s just C:\\\\Users\\\\O\\'Reilly\\\\docs\\\\.";
		expect( escapeSingleQuotes( input ) ).toBe( expected );
	} );
} );
