import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { describe, expect, it } from 'vitest';
import { getWpVersionOptions } from './index';
import type { WordPressVersion } from '@studio/common/lib/wordpress-versions';

const VERSIONS: WordPressVersion[] = [
	{ label: '7.1', value: 'latest', isBeta: false, isDevelopment: false },
	{ label: 'nightly', value: '7.2-alpha-63347', isBeta: false, isDevelopment: true },
	{ label: '7.1', value: '7.1', isBeta: false, isDevelopment: false },
	{ label: '6.9', value: '6.9.7', isBeta: false, isDevelopment: false },
];

function autoUpdateLabel( options = getWpVersionOptions( VERSIONS ) ) {
	return options?.[ 0 ].label;
}

describe( 'getWpVersionOptions', () => {
	it( 'keeps the seed for a pinned site renderable but not offered', () => {
		// The settings form seeds this value when a pinned site's installed
		// version can't be read.
		expect( getWpVersionOptions( VERSIONS, { latestValue: '' } ) ).toContainEqual( {
			value: DEFAULT_WORDPRESS_VERSION,
			label: 'Unknown version',
			hidden: true,
		} );
	} );

	it( 'names the installed version in the auto-update option', () => {
		const options = getWpVersionOptions( VERSIONS, {
			latestValue: '',
			currentVersion: '6.9.7',
			autoUpdateVersion: '6.9.7',
		} );

		expect( options?.[ 0 ] ).toEqual( {
			value: '',
			label: 'Auto-update (6.9.7)',
			description: 'WordPress installs updates on its own schedule. Currently using version 6.9.7.',
		} );
	} );

	it( 'falls back to the bare mode name when the version is unknown', () => {
		// `latest` is the mode, not a version — "Auto-update (latest)" says nothing.
		for ( const autoUpdateVersion of [ undefined, '', '-', 'latest' ] ) {
			expect(
				autoUpdateLabel( getWpVersionOptions( VERSIONS, { latestValue: '', autoUpdateVersion } ) )
			).toBe( 'Auto-update' );
		}
	} );

	it( 'names the version a new site will be created with', () => {
		const options = getWpVersionOptions( VERSIONS, { autoUpdateVersion: '7.1' } );

		expect( options?.[ 0 ] ).toEqual( {
			value: DEFAULT_WORDPRESS_VERSION,
			label: 'Auto-update (7.1)',
			description: 'WordPress installs updates on its own schedule. Will install version 7.1.',
		} );
	} );

	it( 'keeps prerelease and stable versions in separate groups', () => {
		const options = getWpVersionOptions( VERSIONS ) ?? [];

		expect( options.filter( ( option ) => option.group === 'Beta & Nightly' ) ).toEqual( [
			{ value: '7.2-alpha-63347', label: 'nightly', group: 'Beta & Nightly' },
		] );
		expect(
			options.filter( ( option ) => option.group === 'Stable Versions' ).map( ( o ) => o.value )
		).toEqual( [ '7.1', '6.9.7' ] );
	} );

	it( 'sorts an installed version missing from the offers into its group', () => {
		const options = getWpVersionOptions( VERSIONS, { latestValue: '', currentVersion: '7.0.2' } );

		expect(
			options?.filter( ( option ) => option.group === 'Stable Versions' ).map( ( o ) => o.value )
		).toEqual( [ '7.1', '7.0.2', '6.9.7' ] );
	} );

	it( 'offers nothing to the create form without a version list', () => {
		expect( getWpVersionOptions( undefined ) ).toBeUndefined();
		expect( getWpVersionOptions( undefined, { offline: true } ) ).toHaveLength( 1 );
	} );
} );
