import { pullSelectionFromSyncOptions } from 'cli/lib/pull/pull-selection';
import type { SyncOption } from '@studio/common/types/sync';

describe( 'pullSelectionFromSyncOptions', () => {
	// The app's presets and file picks, as `studio pull --options` receives them.
	it.each< [ string, SyncOption[], string[] | undefined, object ] >( [
		[ 'everything', [ 'all' ], undefined, {} ],
		[ 'the database', [ 'sqls' ], undefined, { skipFiles: true } ],
		[
			'all files',
			[ 'plugins', 'themes', 'uploads', 'contents' ],
			undefined,
			{ skipDatabase: true },
		],
		[
			'some folders',
			[ 'themes', 'sqls' ],
			undefined,
			{ only: [ 'themes' ], skipDatabase: false },
		],
		[
			'picked files',
			[ 'paths' ],
			[ 'plugins/akismet' ],
			{ only: [ 'plugins/akismet' ], skipDatabase: true },
		],
		[ 'only the database, picked', [ 'sqls' ], [], { skipFiles: true } ],
	] )( 'pulls %s', ( _, options, only, expected ) => {
		expect( pullSelectionFromSyncOptions( options, only ) ).toEqual( expected );
	} );
} );
