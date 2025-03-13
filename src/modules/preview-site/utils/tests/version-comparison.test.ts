import { DEFAULT_PHP_VERSION } from 'vendor/wp-now/src/constants';
import { compareVersions } from '../version-comparison';

describe( 'compareVersions', () => {
	it( 'should return false for all mismatches when versions match', () => {
		const result = compareVersions( {
			wpVersion: '6.4.2',
			latestWpVersion: '6.4.2',
			phpVersion: DEFAULT_PHP_VERSION,
		} );

		expect( result ).toEqual( {
			phpVersionMismatch: false,
			wpVersionMismatch: false,
		} );
	} );

	it( 'should detect PHP version mismatch', () => {
		const result = compareVersions( {
			wpVersion: '6.4.2',
			latestWpVersion: '6.4.2',
			phpVersion: '7.4',
		} );

		expect( result ).toEqual( {
			phpVersionMismatch: true,
			wpVersionMismatch: false,
		} );
	} );

	it( 'should detect WordPress version mismatch', () => {
		const result = compareVersions( {
			wpVersion: '6.3.1',
			latestWpVersion: '6.4.2',
			phpVersion: DEFAULT_PHP_VERSION,
		} );

		expect( result ).toEqual( {
			phpVersionMismatch: false,
			wpVersionMismatch: true,
		} );
	} );

	it( 'should handle missing latest WordPress version', () => {
		const result = compareVersions( {
			wpVersion: '6.4.2',
			latestWpVersion: undefined,
			phpVersion: DEFAULT_PHP_VERSION,
		} );

		expect( result ).toEqual( {
			phpVersionMismatch: false,
			wpVersionMismatch: false,
		} );
	} );

	it( 'should handle invalid WordPress versions', () => {
		const result = compareVersions( {
			wpVersion: 'invalid',
			latestWpVersion: '6.4.2',
			phpVersion: DEFAULT_PHP_VERSION,
		} );

		expect( result ).toEqual( {
			phpVersionMismatch: false,
			wpVersionMismatch: false,
		} );
	} );
} );
