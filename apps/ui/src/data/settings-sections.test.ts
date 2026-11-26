import { describe, expect, it } from 'vitest';
import { getSections } from './settings-sections';

describe( 'getSections', () => {
	it( 'leaves out the MCP section away from the computer the sites run on', () => {
		const ids = ( localMachine: boolean ) =>
			getSections( 'studio', { localMachine } ).map( ( section ) => section.id );
		expect( ids( true ) ).toContain( 'mcp' );
		expect( ids( false ) ).not.toContain( 'mcp' );
		expect( ids( false ) ).toContain( 'skills' );
	} );

	it( 'leaves out Skills where the host keeps no skills for all sites', () => {
		const ids = ( globalSkills: boolean ) =>
			getSections( 'studio', { globalSkills } ).map( ( section ) => section.id );
		expect( ids( true ) ).toContain( 'skills' );
		expect( ids( false ) ).not.toContain( 'skills' );
		expect(
			getSections( 'site', { globalSkills: false } ).map( ( section ) => section.id )
		).toContain( 'site-skills' );
	} );

	it( 'leaves out the local app settings away from the computer the sites run on', () => {
		const localApps = [ 'code-editor', 'browser', 'terminal', 'default-directory' ];
		const settingIds = ( localMachine: boolean ) =>
			getSections( 'studio', { localMachine } )
				.flatMap( ( section ) => section.settings )
				.map( ( setting ) => setting.id );
		expect( settingIds( true ) ).toEqual( expect.arrayContaining( localApps ) );
		expect( settingIds( false ).filter( ( id ) => localApps.includes( id ?? '' ) ) ).toEqual( [] );
		expect( settingIds( false ) ).toContain( 'usage-statistics' );
	} );

	it( 'leaves out hosting providers whose sites only the user’s computer connects', () => {
		const settingIds = ( localMachine: boolean ) =>
			getSections( 'studio', { localMachine, loopbackSignIn: localMachine } )
				.flatMap( ( section ) => section.settings )
				.map( ( setting ) => setting.id );
		expect( settingIds( true ) ).toContain( 'ssh-provider' );
		expect( settingIds( false ) ).not.toContain( 'ssh-provider' );
		expect( settingIds( false ) ).toContain( 'spacefast-provider' );
	} );
} );
