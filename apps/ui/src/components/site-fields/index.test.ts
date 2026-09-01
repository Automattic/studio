import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { describe, expect, it } from 'vitest';
import { wpVersionField } from './index';
import type { WpVersionOption } from './wp-version-control';
import type { WordPressVersion } from '@studio/common/lib/wordpress-versions';

const VERSIONS: WordPressVersion[] = [
	{ label: '7.1', value: 'latest', isBeta: false, isDevelopment: false },
	{ label: 'nightly', value: '7.2-alpha-63347', isBeta: false, isDevelopment: true },
	{ label: '7.1', value: '7.1', isBeta: false, isDevelopment: false },
	{ label: '6.9', value: '6.9.7', isBeta: false, isDevelopment: false },
];

function optionsOf( field: ReturnType< typeof wpVersionField > ): WpVersionOption[] {
	return ( field.elements ?? [] ) as WpVersionOption[];
}

function autoUpdateLabels( field: ReturnType< typeof wpVersionField > ): string[] {
	return optionsOf( field )
		.filter( ( option ) => option.group === 'latest' )
		.map( ( option ) => option.label );
}

describe( 'wpVersionField', () => {
	it( 'names the installed version in the auto-update option', () => {
		const field = wpVersionField( DEFAULT_WORDPRESS_VERSION, VERSIONS, {
			latestValue: '',
			installedVersion: '6.9.7',
		} );

		expect( autoUpdateLabels( field ) ).toEqual( [ 'Auto-update (6.9.7)' ] );
	} );

	it( 'keeps the seed for a pinned site out of the auto-update group', () => {
		const field = wpVersionField( DEFAULT_WORDPRESS_VERSION, VERSIONS, { latestValue: '' } );

		// The settings form seeds this value when a pinned site's installed
		// version can't be read. It has to stay selectable and unoffered, and it
		// must not claim the site auto-updates.
		expect( optionsOf( field ) ).toContainEqual( {
			value: DEFAULT_WORDPRESS_VERSION,
			label: 'Unknown version',
			group: 'stable',
			hidden: true,
		} );
	} );

	it( 'falls back to the bare mode name when the installed version is unknown', () => {
		// `latest` is the mode, not a version — "Auto-update (latest)" says nothing.
		for ( const installedVersion of [ undefined, '', '-', 'latest' ] ) {
			const field = wpVersionField( DEFAULT_WORDPRESS_VERSION, VERSIONS, {
				latestValue: '',
				installedVersion,
			} );

			expect( autoUpdateLabels( field ) ).toEqual( [ 'Auto-update' ] );
		}
	} );

	it( 'uses the bare mode name on the create form, which has no site yet', () => {
		const field = wpVersionField( DEFAULT_WORDPRESS_VERSION, VERSIONS );

		expect( autoUpdateLabels( field ) ).toEqual( [ 'Auto-update' ] );
	} );

	it( 'keeps prerelease and stable versions in separate groups', () => {
		const field = wpVersionField( DEFAULT_WORDPRESS_VERSION, VERSIONS );
		const options = optionsOf( field );

		expect( options.filter( ( option ) => option.group === 'prerelease' ) ).toEqual( [
			{ value: '7.2-alpha-63347', label: 'nightly', group: 'prerelease', current: false },
		] );
		expect(
			options.filter( ( option ) => option.group === 'stable' ).map( ( o ) => o.value )
		).toEqual( [ '7.1', '6.9.7' ] );
	} );
} );
