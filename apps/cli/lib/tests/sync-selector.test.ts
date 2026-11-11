import { describe, expect, it, vi } from 'vitest';
import { buildTreeFromRemote, selectSyncItemsForPull } from 'cli/lib/sync-selector';
import treeCheckbox from 'cli/lib/tree-checkbox';

vi.mock( 'cli/lib/tree-checkbox' );
vi.mock( 'cli/lib/sync-api' );

describe( 'selectSyncItemsForPull', () => {
	it.each( [ 'plugins', 'plugins/akismet' ] )(
		'returns the real path separately from the backup node id for %s',
		async ( path ) => {
			const tree = buildTreeFromRemote( [
				{
					name: path.split( '/' ).at( -1 )!,
					path: `/wp-content/${ path }`,
					isDirectory: true,
					pathId: 'opaque-id',
				},
			] );
			vi.mocked( treeCheckbox ).mockResolvedValueOnce( tree );

			expect( await selectSyncItemsForPull( 'token', 42, tree ) ).toEqual( {
				optionsToSync: [ 'paths' ],
				includePathList: [ 'opaque-id' ],
				specificSelectionPaths: [ path ],
			} );
		}
	);
} );
