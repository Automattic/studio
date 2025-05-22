import { getLocalizedLink } from 'src/lib/get-localized-link';

describe( 'getLocalizedLink', () => {
	it( 'should return the English URL when locale is en', () => {
		expect( getLocalizedLink( 'en', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/'
		);
	} );

	it( 'should return the English URL when locale has no translation', () => {
		expect( getLocalizedLink( 'uk', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/'
		);
		expect( getLocalizedLink( 'tr', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/'
		);
	} );

	it( 'should return the translated URL when locale exists', () => {
		expect( getLocalizedLink( 'es', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/es/blog/2025/04/02/modifica-las-versiones-de-wordpress-y-php-de-tu-sitio-local-con-studio/'
		);
		expect( getLocalizedLink( 'ja', 'blogPreviewSites' ) ).toBe(
			'https://wordpress.com/ja/blog/2025/03/28/studio-preview-sites/'
		);
		expect( getLocalizedLink( 'pt-br', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/pt-br/blog/2025/04/02/estudio-wordpress-php-versoes/'
		);
	} );
	describe( 'getLocalizedLink for docs', () => {
		it( 'should return English URLs when locale is en', () => {
			expect( getLocalizedLink( 'en', 'docsStudio' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/'
			);
			expect( getLocalizedLink( 'en', 'docsImportExport' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/import-export/'
			);
		} );

		it( 'should return English URLs when locale is not in available translations', () => {
			expect( getLocalizedLink( 'uk', 'docsSites' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/sites/'
			);
			expect( getLocalizedLink( 'fr', 'docsSync' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/sync/'
			);
		} );

		it( 'should return Spanish URLs when locale is es', () => {
			expect( getLocalizedLink( 'es', 'docsStudio' ) ).toBe(
				'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/'
			);
			expect( getLocalizedLink( 'es', 'docsSync' ) ).toBe(
				'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/sync/'
			);
		} );
	} );
} );
