import type { PullSyncOptions, SyncOption } from '@studio/common/types/sync';

export const FULL_PULL: PullSyncOptions = { database: true, files: 'all' };

/** The Reprint pull's `--skip-database`, `--skip-files` and `--only`. */
export type ReprintPullFlags = {
	skipDatabase?: boolean;
	skipFiles?: boolean;
	only?: string[];
};

export function reprintPullFlags( { database, files }: PullSyncOptions ): ReprintPullFlags {
	if ( files === 'none' ) {
		return { skipFiles: true };
	}
	return {
		...( database ? {} : { skipDatabase: true } ),
		...( files === 'all' ? {} : { only: files.paths } ),
	};
}

const LEGACY_FILE_CATEGORIES = [ 'plugins', 'themes', 'uploads' ] as const;

function isLegacyFileCategory( path: string ): path is ( typeof LEGACY_FILE_CATEGORIES )[ number ] {
	return ( LEGACY_FILE_CATEGORIES as readonly string[] ).includes( path );
}

/** The Jetpack Backup pull's `--options` and `--include-path-list`. Goes away with that engine. */
export function legacyPullOptions( { database, files }: PullSyncOptions ): {
	optionsToSync: SyncOption[];
	includePathList?: string[];
} {
	const sqls: SyncOption[] = database ? [ 'sqls' ] : [];
	if ( files === 'all' ) {
		return {
			optionsToSync: database ? [ 'all' ] : [ ...LEGACY_FILE_CATEGORIES, 'contents' ],
		};
	}
	if ( files === 'none' ) {
		return { optionsToSync: sqls };
	}
	if ( files.backupNodeIds?.length ) {
		return { optionsToSync: [ 'paths', ...sqls ], includePathList: files.backupNodeIds };
	}
	// Without Backup node ids, only whole categories can be picked.
	const categories = files.paths.filter( isLegacyFileCategory );
	if ( categories.length !== files.paths.length ) {
		throw new Error(
			'This pull can only pick whole folders: plugins, themes or uploads. Picking other files needs the Reprint pull.'
		);
	}
	return { optionsToSync: [ ...categories, ...sqls ] };
}
