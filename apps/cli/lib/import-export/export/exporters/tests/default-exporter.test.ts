import { describe, it, expect } from 'vitest';
import { bumpStylesheetVersion, isThemeStylesheet } from '../default-exporter';

describe( 'isThemeStylesheet', () => {
	it( 'matches a theme root stylesheet', () => {
		expect( isThemeStylesheet( 'wp-content/themes/my-theme/style.css' ) ).toBe( true );
	} );

	it( 'does not match nested or non-stylesheet files', () => {
		expect( isThemeStylesheet( 'wp-content/themes/my-theme/assets/style.css' ) ).toBe( false );
		expect( isThemeStylesheet( 'wp-content/themes/my-theme/functions.php' ) ).toBe( false );
		expect( isThemeStylesheet( 'wp-content/plugins/my-plugin/style.css' ) ).toBe( false );
	} );
} );

describe( 'bumpStylesheetVersion', () => {
	const suffix = 'studio-1718560000000';

	it( 'appends the cache-busting suffix to the Version header', () => {
		const stylesheet = [ '/*', 'Theme Name: My Theme', 'Version: 1.4.2', '*/' ].join( '\n' );
		const result = bumpStylesheetVersion( stylesheet, suffix );
		expect( result ).toContain( `Version: 1.4.2-${ suffix }` );
	} );

	it( 'preserves indentation and only touches the version line', () => {
		const stylesheet = [ '/*', ' * Theme Name: My Theme', ' * Version: 2.0', ' */' ].join( '\n' );
		const result = bumpStylesheetVersion( stylesheet, suffix );
		expect( result ).toContain( ` * Version: 2.0-${ suffix }` );
		expect( result ).toContain( ' * Theme Name: My Theme' );
	} );

	it( 'returns the content unchanged when no Version header is present', () => {
		const stylesheet = [ '/*', 'Theme Name: My Theme', '*/' ].join( '\n' );
		expect( bumpStylesheetVersion( stylesheet, suffix ) ).toBe( stylesheet );
	} );

	it( 'is stable for the same input and suffix', () => {
		const stylesheet = 'Version: 1.0';
		expect( bumpStylesheetVersion( stylesheet, suffix ) ).toBe(
			bumpStylesheetVersion( stylesheet, suffix )
		);
	} );
} );
