// To run tests, execute `npm run test -- src/lib/tests/translate-link.test.ts` from the root directory

import { translateLink } from 'src/lib/translate-link';

describe( 'translateLink', () => {
	it( 'should return the English URL when locale is en', () => {
		expect( translateLink( 'en', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/'
		);
	} );

	it( 'should return the English URL when locale has no translation', () => {
		expect( translateLink( 'uk', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/'
		);
	} );

	it( 'should return the Spanish URL when locale is es', () => {
		expect( translateLink( 'es', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/es/blog/2025/04/02/modifica-las-versiones-de-wordpress-y-php-de-tu-sitio-local-con-studio/'
		);

		expect( translateLink( 'es', 'blogPreviewSites' ) ).toBe(
			'https://wordpress.com/es/blog/2025/03/05/colabora-mas-y-mejor-en-studio-con-los-sitios-de-vista-previa/'
		);

		expect( translateLink( 'es', 'blogCustomDomainsHttps' ) ).toBe(
			'https://wordpress.com/es/blog/2025/03/31/studio-custom-domains-https/'
		);
	} );

	it( 'should return the Japanese URL when locale is ja', () => {
		expect( translateLink( 'ja', 'blogPreviewSites' ) ).toBe(
			'https://wordpress.com/ja/blog/2025/03/28/studio-preview-sites/'
		);
	} );

	it( 'should return the French URL when locale is fr', () => {
		expect( translateLink( 'fr', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/fr/blog/2025/03/28/studio-wordpress-php-versions/'
		);
		expect( translateLink( 'fr', 'blogPreviewSites' ) ).toBe(
			'https://wordpress.com/fr/blog/2025/03/04/sites-de-previsualisation-studio/'
		);
	} );

	it( 'should return the Portuguese URL when locale is pt-br', () => {
		expect( translateLink( 'pt-br', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/pt-br/blog/2025/04/02/estudio-wordpress-php-versoes/'
		);
		expect( translateLink( 'pt-br', 'blogPreviewSites' ) ).toBe(
			'https://wordpress.com/pt-br/blog/2025/03/06/estudio-visualizar-sites/'
		);
		expect( translateLink( 'pt-br', 'blogCustomDomainsHttps' ) ).toBe(
			'https://wordpress.com/pt-br/blog/2025/04/03/estudio-dominios-personalizados-https/'
		);
	} );

	describe( 'translateLink for docs', () => {
		it( 'should return English URLs when locale is en', () => {
			expect( translateLink( 'en', 'studio' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/'
			);
			expect( translateLink( 'en', 'importExport' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/import-export/'
			);
		} );

		it( 'should return English URLs when locale is not in available translations', () => {
			expect( translateLink( 'uk', 'sites' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/sites/'
			);
			expect( translateLink( 'fr', 'sync' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/sync/'
			);
		} );

		it( 'should return Spanish URLs when locale is es', () => {
			expect( translateLink( 'es', 'studio' ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/'
			);
			expect( translateLink( 'es', 'importExport' ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/import-export/'
			);
			expect( translateLink( 'es', 'sites' ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/sites/'
			);
			expect( translateLink( 'es', 'sync' ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/sync/'
			);
			expect( translateLink( 'es', 'cli' ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/cli/'
			);
		} );
	} );
} );
