import { checkbox, Separator } from '@inquirer/prompts';
import { __ } from '@wordpress/i18n';
import { fetchLatestRewindId, fetchRemoteFileTree } from 'cli/lib/sync-api';
import { listLocalFileTree } from 'cli/lib/sync-file-tree';
import type { SyncOption } from '@studio/common/types/sync';
import type { RawDirectoryEntry } from '@studio/common/types/sync-tree';
import type { RemoteFileEntry } from 'cli/lib/sync-api';

type SyncSelection = {
	type: 'database' | 'wp-content';
	path?: string;
	pathId?: string;
};

function categorizePath( relativePath: string ): SyncOption {
	if ( relativePath.startsWith( 'plugins/' ) || relativePath === 'plugins' ) {
		return 'plugins';
	}
	if ( relativePath.startsWith( 'themes/' ) || relativePath === 'themes' ) {
		return 'themes';
	}
	if ( relativePath.startsWith( 'uploads/' ) || relativePath === 'uploads' ) {
		return 'uploads';
	}
	return 'contents';
}

function buildChoicesFromLocal( entries: RawDirectoryEntry[] ): {
	choices: ( { name: string; value: SyncSelection; checked: boolean } | Separator )[];
} {
	const choices: ( { name: string; value: SyncSelection; checked: boolean } | Separator )[] = [];

	choices.push( {
		name: __( 'Database (SQL)' ),
		value: { type: 'database' },
		checked: true,
	} );

	choices.push( new Separator( '── wp-content ──' ) );

	const sorted = [ ...entries ].sort( ( a, b ) => {
		if ( a.isDirectory !== b.isDirectory ) {
			return a.isDirectory ? -1 : 1;
		}
		return a.name.localeCompare( b.name );
	} );

	for ( const entry of sorted ) {
		const relativePath = entry.path.replace( /^wp-content\//, '' );

		if ( entry.isDirectory && entry.children?.length ) {
			for ( const child of entry.children ) {
				const childRelativePath = child.path.replace( /^wp-content\//, '' );
				choices.push( {
					name: childRelativePath,
					value: { type: 'wp-content', path: childRelativePath },
					checked: true,
				} );
			}
		} else {
			choices.push( {
				name: relativePath + ( entry.isDirectory ? '/' : '' ),
				value: { type: 'wp-content', path: relativePath },
				checked: true,
			} );
		}
	}

	return { choices };
}

function buildChoicesFromRemote( entries: RemoteFileEntry[] ): {
	choices: ( { name: string; value: SyncSelection; checked: boolean } | Separator )[];
} {
	const choices: ( { name: string; value: SyncSelection; checked: boolean } | Separator )[] = [];

	choices.push( {
		name: __( 'Database (SQL)' ),
		value: { type: 'database' },
		checked: true,
	} );

	choices.push( new Separator( '── wp-content ──' ) );

	const sorted = [ ...entries ].sort( ( a, b ) => {
		if ( a.isDirectory !== b.isDirectory ) {
			return a.isDirectory ? -1 : 1;
		}
		return a.name.localeCompare( b.name );
	} );

	for ( const entry of sorted ) {
		const relativePath = entry.path.replace( /^wp-content\//, '' );
		choices.push( {
			name: relativePath,
			value: { type: 'wp-content', path: relativePath, pathId: entry.pathId },
			checked: true,
		} );
	}

	return { choices };
}

function convertSelectionsToSyncOptions( selections: SyncSelection[] ): {
	optionsToSync: SyncOption[];
	specificSelectionPaths?: string[];
} {
	const hasDatabase = selections.some( ( s ) => s.type === 'database' );
	const wpContentSelections = selections.filter( ( s ) => s.type === 'wp-content' );

	if ( hasDatabase && wpContentSelections.length === 0 ) {
		return { optionsToSync: [ 'sqls' ] };
	}

	const optionsToSync: SyncOption[] = [];
	const specificSelectionPaths: string[] = [];

	if ( hasDatabase ) {
		optionsToSync.push( 'sqls' );
	}

	const categories = new Set< SyncOption >();
	for ( const selection of wpContentSelections ) {
		if ( selection.path ) {
			categories.add( categorizePath( selection.path ) );
			specificSelectionPaths.push( selection.path );
		}
	}

	optionsToSync.push( ...categories );

	return {
		optionsToSync,
		specificSelectionPaths: specificSelectionPaths.length > 0 ? specificSelectionPaths : undefined,
	};
}

function convertSelectionsToPullOptions( selections: SyncSelection[] ): {
	optionsToSync: SyncOption[];
	includePathList?: string[];
} {
	const hasDatabase = selections.some( ( s ) => s.type === 'database' );
	const wpContentSelections = selections.filter( ( s ) => s.type === 'wp-content' );

	if ( hasDatabase && wpContentSelections.length === 0 ) {
		return { optionsToSync: [ 'sqls' ] };
	}

	const optionsToSync: SyncOption[] = [];
	const pathIds: string[] = [];

	if ( hasDatabase ) {
		optionsToSync.push( 'sqls' );
	}

	for ( const selection of wpContentSelections ) {
		if ( selection.pathId ) {
			pathIds.push( selection.pathId );
		}
	}

	if ( pathIds.length > 0 ) {
		optionsToSync.unshift( 'paths' );
	}

	return {
		optionsToSync,
		includePathList: pathIds.length > 0 ? pathIds : undefined,
	};
}

export async function selectSyncItemsForPush(
	sitePath: string
): Promise< { optionsToSync: SyncOption[]; specificSelectionPaths?: string[] } > {
	const entries = await listLocalFileTree( sitePath, 'wp-content', 2 );
	const { choices } = buildChoicesFromLocal( entries );

	if ( choices.length <= 2 ) {
		// Only database + separator, no wp-content entries
		return { optionsToSync: [ 'all' ] };
	}

	const selections = await checkbox< SyncSelection >( {
		message: __( 'Select items to sync' ),
		choices,
	} );

	if ( selections.length === 0 ) {
		throw new Error( __( 'No items selected for sync' ) );
	}

	const totalSelectable = choices.filter( ( c ) => ! ( c instanceof Separator ) ).length;
	if ( selections.length === totalSelectable ) {
		return { optionsToSync: [ 'all' ] };
	}

	return convertSelectionsToSyncOptions( selections );
}

export async function selectSyncItemsForPull(
	token: string,
	remoteSiteId: number
): Promise< { optionsToSync: SyncOption[]; includePathList?: string[] } > {
	const rewindId = await fetchLatestRewindId( token, remoteSiteId );
	const entries = await fetchRemoteFileTree( token, remoteSiteId, rewindId, 'wp-content/' );
	const { choices } = buildChoicesFromRemote( entries );

	if ( choices.length <= 2 ) {
		return { optionsToSync: [ 'all' ] };
	}

	const selections = await checkbox< SyncSelection >( {
		message: __( 'Select items to sync' ),
		choices,
	} );

	if ( selections.length === 0 ) {
		throw new Error( __( 'No items selected for sync' ) );
	}

	const totalSelectable = choices.filter( ( c ) => ! ( c instanceof Separator ) ).length;
	if ( selections.length === totalSelectable ) {
		return { optionsToSync: [ 'all' ] };
	}

	return convertSelectionsToPullOptions( selections );
}
