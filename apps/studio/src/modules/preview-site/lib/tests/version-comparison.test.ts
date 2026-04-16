import { RecommendedPHPVersion as DEFAULT_PHP_VERSION } from '@studio/common/types/php-versions';
import { hasUnsupportedWpOrPhpVersion } from 'src/modules/preview-site/lib/version-comparison';

describe( 'hasUnsupportedWpOrPhpVersion', () => {
	it( 'should return true when WordPress version is older than latest', () => {
		const result = hasUnsupportedWpOrPhpVersion( {
			wpVersion: '6.3',
			latestWpVersion: '6.4',
			phpVersion: '8.2',
		} );
		expect( result ).toBe( true );
	} );

	it( 'should return true when PHP version is default', () => {
		const result = hasUnsupportedWpOrPhpVersion( {
			wpVersion: '6.4',
			latestWpVersion: '6.4',
			phpVersion: DEFAULT_PHP_VERSION,
		} );
		expect( result ).toBe( false );
	} );

	it( 'should return false when versions are up to date', () => {
		const result = hasUnsupportedWpOrPhpVersion( {
			wpVersion: '6.4',
			latestWpVersion: '6.4',
			phpVersion: '8.2',
		} );
		expect( result ).toBe( true );
	} );

	it( 'should return false when WordPress version is newer than latest', () => {
		const result = hasUnsupportedWpOrPhpVersion( {
			wpVersion: '6.5',
			latestWpVersion: '6.4',
			phpVersion: '8.2',
		} );
		expect( result ).toBe( true );
	} );

	it( 'should handle undefined latest WordPress version', () => {
		const result = hasUnsupportedWpOrPhpVersion( {
			wpVersion: '6.4',
			latestWpVersion: undefined,
			phpVersion: '8.2',
		} );
		expect( result ).toBe( true );
	} );

	it( 'should handle invalid WordPress versions', () => {
		const result = hasUnsupportedWpOrPhpVersion( {
			wpVersion: 'invalid',
			latestWpVersion: '6.4',
			phpVersion: '8.2',
		} );
		expect( result ).toBe( true );
	} );
} );
