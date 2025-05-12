// To run tests, execute `npm run test -- src/lib/tests/translate-link.test.ts` from the root directory

import { BLOG_LINKS, DOCS_LINKS, translateLink } from 'src/lib/translate-link';

describe( 'translateLink', () => {
	it( 'should return the original URL when locale is en', () => {
		const testUrl = 'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/';
		expect( translateLink( 'en', testUrl ) ).toBe( testUrl );
	} );

	it( 'should return the original URL when locale has no translation', () => {
		const testUrl = 'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/';
		expect( translateLink( 'uk', testUrl ) ).toBe( testUrl );
	} );

	it( 'should return the Spanish URL when locale is es', () => {
		expect( translateLink( 'es', BLOG_LINKS[ 'php-versions' ] ) ).toBe(
			'https://wordpress.com/es/blog/2025/04/02/modifica-las-versiones-de-wordpress-y-php-de-tu-sitio-local-con-studio/'
		);

		expect( translateLink( 'es', BLOG_LINKS[ 'preview-sites' ] ) ).toBe(
			'https://wordpress.com/es/blog/2025/03/05/colabora-mas-y-mejor-en-studio-con-los-sitios-de-vista-previa/'
		);

		expect( translateLink( 'es', BLOG_LINKS[ 'custom-domains-https' ] ) ).toBe(
			'https://wordpress.com/es/blog/2025/03/31/studio-custom-domains-https/'
		);
	} );

	it( 'should return the Japanese URL when locale is ja', () => {
		expect( translateLink( 'ja', BLOG_LINKS[ 'preview-sites' ] ) ).toBe(
			'https://wordpress.com/ja/blog/2025/03/28/studio-preview-sites/'
		);
	} );

	it( 'should return the original URL for untranslated links', () => {
		const untranslatedUrl = 'https://wordpress.com/blog/2025/05/09/fake-url/';
		expect( translateLink( 'es', untranslatedUrl ) ).toBe( untranslatedUrl );
		expect( translateLink( 'ja', untranslatedUrl ) ).toBe( untranslatedUrl );
	} );
	describe( 'translateLink for docs', () => {
		it( 'should return English URLs when locale is en', () => {
			expect( translateLink( 'en', DOCS_LINKS.studio ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/'
			);
			expect( translateLink( 'en', DOCS_LINKS.importExport ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/import-export/'
			);
		} );

		it( 'should return English URLs when locale is not in available translations', () => {
			expect( translateLink( 'uk', DOCS_LINKS.sites ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/sites/'
			);
			expect( translateLink( 'fr', DOCS_LINKS.sync ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/sync/'
			);
		} );

		it( 'should return Spanish URLs when locale is es', () => {
			expect( translateLink( 'es', DOCS_LINKS.studio ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/'
			);
			expect( translateLink( 'es', DOCS_LINKS.importExport ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/import-export/'
			);
			expect( translateLink( 'es', DOCS_LINKS.sites ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/sites/'
			);
			expect( translateLink( 'es', DOCS_LINKS.sync ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/sync/'
			);
			expect( translateLink( 'es', DOCS_LINKS.cli ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/cli/'
			);
		} );
	} );
} );
