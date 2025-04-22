import { getDocsLink } from 'src/lib/get-docs-link';

describe( 'getDocsLink', () => {
	it( 'should return English URLs when locale is en', () => {
		expect( getDocsLink( 'en', 'studio' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/'
		);
		expect( getDocsLink( 'en', 'importExport' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/import-export/'
		);
		expect( getDocsLink( 'en', 'sites' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/sites/'
		);
		expect( getDocsLink( 'en', 'sync' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/sync/'
		);
	} );

	it( 'should return English URLs when locale is not in available translations', () => {
		expect( getDocsLink( 'uk', 'studio' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/'
		);
		expect( getDocsLink( 'uk', 'importExport' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/import-export/'
		);
		expect( getDocsLink( 'uk', 'sites' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/sites/'
		);
		expect( getDocsLink( 'uk', 'sync' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/sync/'
		);
	} );

	it( 'should return Spanish URLs when locale is es', () => {
		expect( getDocsLink( 'es', 'studio' ) ).toBe(
			'https://developer.wordpress.com/es/docs/developer-tools/studio/'
		);
		expect( getDocsLink( 'es', 'importExport' ) ).toBe(
			'https://developer.wordpress.com/es/docs/developer-tools/studio/import-export/'
		);
		expect( getDocsLink( 'es', 'sites' ) ).toBe(
			'https://developer.wordpress.com/es/docs/developer-tools/studio/sites/'
		);
		expect( getDocsLink( 'es', 'sync' ) ).toBe(
			'https://developer.wordpress.com/es/docs/developer-tools/studio/sync/'
		);
	} );
} );
