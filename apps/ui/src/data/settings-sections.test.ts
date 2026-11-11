import { describe, expect, it } from 'vitest';
import { getSections } from './settings-sections';

describe( 'getSections', () => {
	it.each( [
		[ 'studio', 'mcp' ],
		[ 'studio', 'skills' ],
		[ 'site', 'php' ],
		[ 'site', 'site-skills' ],
		[ 'site', 'site-instructions' ],
	] as const )( 'leaves out the %s section %s where sites are not native', ( scope, id ) => {
		const ids = ( nativeSites: boolean ) =>
			getSections( scope, { nativeSites } ).map( ( section ) => section.id );
		expect( ids( true ) ).toContain( id );
		expect( ids( false ) ).not.toContain( id );
	} );

	it( 'leaves out the local app and analytics settings where sites are not native', () => {
		const localApps = [
			'code-editor',
			'browser',
			'terminal',
			'default-directory',
			'usage-statistics',
		];
		const settingIds = ( nativeSites: boolean ) =>
			getSections( 'studio', { nativeSites } )
				.flatMap( ( section ) => section.settings )
				.map( ( setting ) => setting.id );
		expect( settingIds( true ) ).toEqual( expect.arrayContaining( localApps ) );
		expect( settingIds( false ).filter( ( id ) => localApps.includes( id ?? '' ) ) ).toEqual( [] );
	} );
} );
