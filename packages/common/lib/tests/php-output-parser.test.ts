import { describe, expect, it } from 'vitest';
import { parseJsonFromPhpOutput } from '@studio/common/lib/php-output-parser';

describe( 'parseJsonFromPhpOutput', () => {
	it.each( [
		[ 'clean output', '{"slug":"twentytwentyfive"}', { slug: 'twentytwentyfive' } ],
		[ 'a notice before the JSON', 'Deprecated: foo in bar.php\n["a","b"]', [ 'a', 'b' ] ],
		[ 'a bracketed notice before null', '[notice X 0] something\nnull', null ],
		[ 'a bracketed notice after null', 'null\n[notice X 0] something', null ],
		[ 'a notice on the same line', 'Notice: foo{"a":1}', { a: 1 } ],
		[ 'multi-line JSON after a notice', 'Notice: foo\n{\n  "a": 1\n}', { a: 1 } ],
	] )( 'parses %s', ( _, output, expected ) => {
		expect( parseJsonFromPhpOutput( output ) ).toEqual( expected );
	} );

	it( 'throws when there is no JSON', () => {
		expect( () => parseJsonFromPhpOutput( 'Fatal error' ) ).toThrow( SyntaxError );
	} );
} );
