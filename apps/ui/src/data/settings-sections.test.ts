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
} );
