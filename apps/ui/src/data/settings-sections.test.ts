import { describe, expect, it } from 'vitest';
import { getSections } from './settings-sections';

const ids = ( capabilities = {} ) =>
	getSections( 'studio', { capabilities } ).map( ( section ) => section.id );

describe( 'getSections', () => {
	it( 'leaves out the MCP and skills sections where sites have no folders or agent files', () => {
		expect( ids() ).toEqual( expect.arrayContaining( [ 'mcp', 'skills' ] ) );
		expect( ids( { siteFolders: false } ) ).not.toContain( 'mcp' );
		expect( ids( { siteAgentFiles: false } ) ).not.toContain( 'skills' );
	} );

	it( 'leaves out the local app settings where sites have no folders', () => {
		const settingIds = ( siteFolders: boolean ) =>
			getSections( 'studio', { capabilities: { siteFolders } } )
				.flatMap( ( section ) => section.settings )
				.map( ( setting ) => setting.id );
		const localApps = [ 'code-editor', 'browser', 'terminal', 'default-directory' ];
		expect( settingIds( true ) ).toEqual( expect.arrayContaining( localApps ) );
		expect( settingIds( false ).filter( ( id ) => localApps.includes( id ?? '' ) ) ).toEqual( [] );
	} );
} );
