import { getLink } from 'src/lib/get-link';

describe( 'getLink', () => {
	it( 'should return the English URL when locale is en', () => {
		expect( getLink( 'en', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/'
		);
	} );

	it( 'should return the English URL when locale has no translation', () => {
		expect( getLink( 'uk', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/'
		);
		expect( getLink( 'tr', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/'
		);
	} );

	it( 'should return the translated URL when locale exists', () => {
		expect( getLink( 'es', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/es/blog/2025/04/02/modifica-las-versiones-de-wordpress-y-php-de-tu-sitio-local-con-studio/'
		);
		expect( getLink( 'ja', 'blogPreviewSites' ) ).toBe(
			'https://wordpress.com/ja/blog/2025/03/28/studio-preview-sites/'
		);
		expect( getLink( 'pt-br', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/pt-br/blog/2025/04/02/estudio-wordpress-php-versoes/'
		);
	} );
	describe( 'getLink for docs', () => {
		it( 'should return English URLs when locale is en', () => {
			expect( getLink( 'en', 'docsStudio' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/'
			);
			expect( getLink( 'en', 'docsImportExport' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/import-export/'
			);
		} );

		it( 'should return English URLs when locale is not in available translations', () => {
			expect( getLink( 'uk', 'docsSites' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/sites/'
			);
			expect( getLink( 'fr', 'docsSync' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/sync/'
			);
		} );

		it( 'should return Spanish URLs when locale is es', () => {
			expect( getLink( 'es', 'docsStudio' ) ).toBe(
				'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/'
			);
			expect( getLink( 'es', 'docsSync' ) ).toBe(
				'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/sync/'
			);
		} );
	} );
} );
