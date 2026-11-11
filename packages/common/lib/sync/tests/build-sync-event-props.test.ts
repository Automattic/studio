import { describe, expect, it } from 'vitest';
import {
	buildSyncEventProps,
	classifySyncSelection,
} from '@studio/common/lib/sync/build-sync-event-props';

describe( 'classifySyncSelection', () => {
	it.each( [
		[ 'full Reprint pull', {}, 'full', true ],
		[ 'database only', { skipFiles: true }, 'categories', true ],
		[ 'first database only', { databaseOnly: true }, 'categories', true ],
		[ 'all files only', { skipDatabase: true }, 'categories', false ],
		[
			'plugins and themes',
			{ skipDatabase: true, fileOnlyPaths: [ ':wp-content:/plugins', ':wp-content:/themes' ] },
			'categories',
			false,
		],
		[
			'Reprint plugin folder',
			{ fileOnlyPaths: [ ':wp-content:/plugins/akismet' ] },
			'folders',
			true,
		],
		[
			'Reprint uploads folder',
			{ skipDatabase: true, fileOnlyPaths: [ ':wp-content:/uploads/2024' ] },
			'folders',
			false,
		],
		[ 'full legacy sync', { optionsToSync: [ 'all' ] }, 'full', true ],
		[ 'legacy database only', { optionsToSync: [ 'sqls' ] }, 'categories', true ],
		[ 'whole categories', { optionsToSync: [ 'plugins', 'themes' ] }, 'categories', false ],
		[ 'all files category', { optionsToSync: [ 'contents' ] }, 'categories', false ],
		[ 'all files and database', { optionsToSync: [ 'contents', 'sqls' ] }, 'full', true ],
		[
			'legacy whole plugins category',
			{ optionsToSync: [ 'paths', 'sqls' ], specificSelectionPaths: [ 'plugins' ] },
			'categories',
			true,
		],
		[
			'legacy plugin folder',
			{ optionsToSync: [ 'paths' ], specificSelectionPaths: [ 'plugins/akismet' ] },
			'folders',
			false,
		],
		[ 'legacy paths without real paths', { optionsToSync: [ 'paths', 'sqls' ] }, 'unknown', true ],
		[
			'push specific paths',
			{ optionsToSync: [ 'plugins' ], specificSelectionPaths: [ 'wp-content/plugins/akismet' ] },
			'folders',
			false,
		],
		[
			'push whole category paths',
			{
				optionsToSync: [ 'plugins', 'themes', 'sqls' ],
				specificSelectionPaths: [ 'wp-content/plugins', 'wp-content/themes/' ],
			},
			'categories',
			true,
		],
	] satisfies Array<
		[ string, Parameters< typeof classifySyncSelection >[ 0 ], string, boolean ]
	> )( '%s', ( _name, input, selection, includes_database ) => {
		expect( classifySyncSelection( input ) ).toEqual( { selection, includes_database } );
	} );
} );

describe( 'buildSyncEventProps', () => {
	it.each( [ undefined, new Error( 'sync failed' ) ] )(
		'keeps selection props on success and failure (%s)',
		( error ) => {
			const selection = classifySyncSelection( {
				fileOnlyPaths: [ ':wp-content:/plugins/akismet' ],
			} );
			expect(
				buildSyncEventProps( { startedAt: Date.now(), site: undefined, selection, error } )
			).toEqual( {
				success: error === undefined,
				sync_type: 'unknown',
				time_ms: expect.any( Number ),
				selection: 'folders',
				includes_database: true,
				...( error ? { failure_reason: 'unknown' } : {} ),
			} );
		}
	);
} );
