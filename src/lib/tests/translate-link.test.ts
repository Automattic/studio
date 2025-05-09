// To run tests, execute `npm run test -- src/lib/tests/translate-link.test.ts` from the root directory

import { translateLink } from 'src/lib/translate-link';

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
		expect(
			translateLink( 'es', 'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/' )
		).toBe(
			'https://wordpress.com/es/blog/2025/04/02/modifica-las-versiones-de-wordpress-y-php-de-tu-sitio-local-con-studio/'
		);

		expect(
			translateLink( 'es', 'https://wordpress.com/blog/2025/02/24/studio-preview-sites/' )
		).toBe(
			'https://wordpress.com/es/blog/2025/03/05/colabora-mas-y-mejor-en-studio-con-los-sitios-de-vista-previa/'
		);

		expect(
			translateLink( 'es', 'https://wordpress.com/blog/2025/03/31/studio-custom-domains-https/' )
		).toBe( 'https://wordpress.com/es/blog/2025/03/31/studio-custom-domains-https/' );
	} );

	it( 'should return the Japanese URL when locale is ja', () => {
		expect(
			translateLink( 'ja', 'https://wordpress.com/blog/2025/02/24/studio-preview-sites/' )
		).toBe( 'https://wordpress.com/ja/blog/2025/03/28/studio-preview-sites/' );
	} );

	it( 'should return the original URL for untranslated links', () => {
		const untranslatedUrl = 'https://wordpress.com/blog/2025/05/09/fake-url/';
		expect( translateLink( 'es', untranslatedUrl ) ).toBe( untranslatedUrl );
		expect( translateLink( 'ja', untranslatedUrl ) ).toBe( untranslatedUrl );
	} );
} );
