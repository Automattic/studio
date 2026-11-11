import { describe, expect, it } from 'vitest';
import { legacyPullOptions } from '@studio/common/lib/sync/pull-options';

describe( 'legacyPullOptions', () => {
	it( 'pulls whole folders picked by path', () => {
		expect(
			legacyPullOptions( { database: true, files: { paths: [ 'plugins', 'uploads' ] } } )
		).toEqual( { optionsToSync: [ 'plugins', 'uploads', 'sqls' ] } );
	} );

	it( 'rejects other paths without Backup node ids', () => {
		expect( () =>
			legacyPullOptions( { database: false, files: { paths: [ 'plugins/akismet' ] } } )
		).toThrow( 'Reprint pull' );
	} );
} );
