// To run tests, execute `npm run test -- src/lib/tests/translate-link.test.ts` from the root directory

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
	} );

	it( 'should return the Spanish URL when locale is es', () => {
		expect( getLink( 'es', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/es/blog/2025/04/02/modifica-las-versiones-de-wordpress-y-php-de-tu-sitio-local-con-studio/'
		);

		expect( getLink( 'es', 'blogPreviewSites' ) ).toBe(
			'https://wordpress.com/es/blog/2025/03/05/colabora-mas-y-mejor-en-studio-con-los-sitios-de-vista-previa/'
		);

		expect( getLink( 'es', 'blogCustomDomainsHttps' ) ).toBe(
			'https://wordpress.com/es/blog/2025/03/31/studio-custom-domains-https/'
		);
	} );

	it( 'should return the Japanese URL when locale is ja', () => {
		expect( getLink( 'ja', 'blogPreviewSites' ) ).toBe(
			'https://wordpress.com/ja/blog/2025/03/28/studio-preview-sites/'
		);
	} );

	it( 'should return the French URL when locale is fr', () => {
		expect( getLink( 'fr', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/fr/blog/2025/03/28/studio-wordpress-php-versions/'
		);
		expect( getLink( 'fr', 'blogPreviewSites' ) ).toBe(
			'https://wordpress.com/fr/blog/2025/03/04/sites-de-previsualisation-studio/'
		);
	} );

	it( 'should return the Portuguese URL when locale is pt-br', () => {
		expect( getLink( 'pt-br', 'blogPhpVersions' ) ).toBe(
			'https://wordpress.com/pt-br/blog/2025/04/02/estudio-wordpress-php-versoes/'
		);
		expect( getLink( 'pt-br', 'blogPreviewSites' ) ).toBe(
			'https://wordpress.com/pt-br/blog/2025/03/06/estudio-visualizar-sites/'
		);
		expect( getLink( 'pt-br', 'blogCustomDomainsHttps' ) ).toBe(
			'https://wordpress.com/pt-br/blog/2025/04/03/estudio-dominios-personalizados-https/'
		);
	} );

	describe( 'getLink for docs', () => {
		it( 'should return English URLs when locale is en', () => {
			expect( getLink( 'en', 'studio' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/'
			);
			expect( getLink( 'en', 'importExport' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/import-export/'
			);
		} );

		it( 'should return English URLs when locale is not in available translations', () => {
			expect( getLink( 'uk', 'sites' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/sites/'
			);
			expect( getLink( 'fr', 'sync' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/sync/'
			);
		} );

		it( 'should return Spanish URLs when locale is es', () => {
			expect( getLink( 'es', 'studio' ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/'
			);
			expect( getLink( 'es', 'importExport' ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/import-export/'
			);
			expect( getLink( 'es', 'sites' ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/sites/'
			);
			expect( getLink( 'es', 'sync' ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/sync/'
			);
			expect( getLink( 'es', 'cli' ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/cli/'
			);
		} );
	} );
} );
