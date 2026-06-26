import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities } from '../html-entities';

describe( 'decodeHtmlEntities', () => {
	it( 'decodes numeric and common named HTML entities', () => {
		expect(
			decodeHtmlEntities(
				'$_POST[&#039;getpost-radio&#039;] &amp; &quot;quoted&quot; &#x3c;tag&#x3e;'
			)
		).toBe( '$_POST[\'getpost-radio\'] & "quoted" <tag>' );
	} );

	it( 'leaves unknown entities unchanged', () => {
		expect( decodeHtmlEntities( 'Keep &unknown; as-is.' ) ).toBe( 'Keep &unknown; as-is.' );
	} );
} );
