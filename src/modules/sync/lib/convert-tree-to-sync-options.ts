import { SYNC_OPTIONS } from 'src/constants';
import { PullSiteOptions } from 'src/hooks/sync-sites/use-sync-pull';
import { SYNC_EXCLUSIONS } from 'src/modules/sync/constants';
import type { TreeNode } from 'src/components/tree-view';
import type { SyncOption } from 'src/types';

type PushOptionsWithSelections = {
	optionsToSync: SyncOption[];
	specificSelections?: {
		plugins?: string[];
		themes?: string[];
		uploads?: string[];
	};
};

const shouldExcludePathFromSync = ( path: string ): boolean => {
	const normalizedPath = path.replace( /^wp-content\//, '' ).replace( /^\/+|\/+$/g, '' );

	for ( const exclusion of SYNC_EXCLUSIONS ) {
		if ( normalizedPath === exclusion || normalizedPath.startsWith( exclusion ) ) {
			return true;
		}
	}

	if ( normalizedPath.includes( 'mu-plugins/sqlite-database-integration' ) ) {
		return true;
	}

	return false;
};

const getPathSyncOption = ( path: string ): SyncOption | null => {
	if ( shouldExcludePathFromSync( path ) ) {
		return null;
	}

	const normalizedPath = path.replace( /^wp-content\//, '' ).replace( /^\/+|\/+$/g, '' );

	if ( normalizedPath.startsWith( 'plugins/' ) ) {
		return SYNC_OPTIONS.plugins;
	}
	if ( normalizedPath.startsWith( 'themes/' ) ) {
		return SYNC_OPTIONS.themes;
	}
	if ( normalizedPath.startsWith( 'uploads/' ) ) {
		return SYNC_OPTIONS.uploads;
	}
	if (
		normalizedPath.startsWith( 'mu-plugins/' ) ||
		normalizedPath.startsWith( 'fonts/' ) ||
		normalizedPath.startsWith( 'languages/' ) ||
		normalizedPath === 'mu-plugins' ||
		normalizedPath === 'fonts' ||
		normalizedPath === 'languages'
	) {
		return SYNC_OPTIONS.contents;
	}
	if ( normalizedPath && ! normalizedPath.includes( '../' ) ) {
		return SYNC_OPTIONS.contents;
	}

	return null;
};

const collectPathIds = ( nodes: TreeNode[], pathIds: string[] = [] ): string[] => {
	nodes.forEach( ( node ) => {
		if ( node.checked && node.pathId ) {
			pathIds.push( node.pathId );
		} else if ( node.indeterminate && node.children ) {
			collectPathIds( node.children, pathIds );
		}
	} );
	return pathIds;
};

const collectSelectedPaths = ( nodes: TreeNode[], selectedPaths: string[] = [] ): string[] => {
	nodes.forEach( ( node ) => {
		if ( node.checked && node.path && ! shouldExcludePathFromSync( node.path ) ) {
			selectedPaths.push( node.path );
		} else if ( node.indeterminate && node.children ) {
			collectSelectedPaths( node.children, selectedPaths );
		}
	} );
	return selectedPaths;
};

const groupPathsBySyncOption = ( paths: string[] ): Record< SyncOption, boolean > => {
	const syncOptions: Record< SyncOption, boolean > = {
		[ SYNC_OPTIONS.all ]: false,
		[ SYNC_OPTIONS.sqls ]: false,
		[ SYNC_OPTIONS.paths ]: false,
		[ SYNC_OPTIONS.themes ]: false,
		[ SYNC_OPTIONS.plugins ]: false,
		[ SYNC_OPTIONS.uploads ]: false,
		[ SYNC_OPTIONS.contents ]: false,
	};

	paths.forEach( ( path ) => {
		const syncOption = getPathSyncOption( path );
		if ( syncOption ) {
			syncOptions[ syncOption ] = true;
		}
	} );

	return syncOptions;
};

const extractSpecificSelections = (
	paths: string[]
): PushOptionsWithSelections[ 'specificSelections' ] => {
	const specificSelections: PushOptionsWithSelections[ 'specificSelections' ] = {};
	const plugins = new Set< string >();
	const themes = new Set< string >();
	const uploads = new Set< string >();

	paths.forEach( ( path ) => {
		const normalizedPath = path.replace( /^wp-content\//, '' ).replace( /^\/+|\/+$/g, '' );

		if ( normalizedPath.startsWith( 'plugins/' ) ) {
			const pluginMatch = normalizedPath.match( /^plugins\/([^/]+)/ );
			if ( pluginMatch ) {
				plugins.add( pluginMatch[ 1 ] );
			}
		}

		if ( normalizedPath.startsWith( 'themes/' ) ) {
			const themeMatch = normalizedPath.match( /^themes\/([^/]+)/ );
			if ( themeMatch ) {
				themes.add( themeMatch[ 1 ] );
			}
		}

		if ( normalizedPath.startsWith( 'uploads/' ) ) {
			const uploadMatch = normalizedPath.match( /^uploads\/([^/]+)/ );
			if ( uploadMatch ) {
				uploads.add( uploadMatch[ 1 ] );
			}
		}
	} );

	if ( plugins.size > 0 ) {
		specificSelections.plugins = Array.from( plugins );
	}
	if ( themes.size > 0 ) {
		specificSelections.themes = Array.from( themes );
	}
	if ( uploads.size > 0 ) {
		specificSelections.uploads = Array.from( uploads );
	}

	return Object.keys( specificSelections ).length > 0 ? specificSelections : undefined;
};

const getCommonNodes = ( tree: TreeNode[] ) => {
	const isDatabaseSelected = tree.find( ( node ) => node.id === SYNC_OPTIONS.sqls );
	const filesAndFolders = tree.find( ( node ) => node.id === 'filesAndFolders' );
	const wpContent = filesAndFolders?.children?.find( ( node ) => node.id === 'wp-content' );

	return { isDatabaseSelected, filesAndFolders, wpContent };
};

export const convertTreeToPushOptions = ( tree: TreeNode[] ): PushOptionsWithSelections => {
	const optionsToSync: SyncOption[] = [];

	const isAll = tree.every( ( node ) => node.checked );
	if ( isAll ) {
		optionsToSync.push( SYNC_OPTIONS.all );
		return { optionsToSync, specificSelections: undefined };
	}

	const { isDatabaseSelected, wpContent } = getCommonNodes( tree );

	if ( isDatabaseSelected?.checked ) {
		optionsToSync.push( SYNC_OPTIONS.sqls );
	}

	// Handle wp-content selections using the new file tree structure
	const wpContentChildren = wpContent?.children || [];
	let specificSelections: PushOptionsWithSelections[ 'specificSelections' ] = undefined;

	if ( wpContentChildren.length > 0 ) {
		// New file tree structure - collect all selected file paths and group by sync options
		const selectedPaths = collectSelectedPaths( wpContentChildren );
		const syncOptionGroups = groupPathsBySyncOption( selectedPaths );

		// Add sync options based on what file paths were selected (in consistent order)
		const syncOptionOrder = [
			SYNC_OPTIONS.plugins,
			SYNC_OPTIONS.themes,
			SYNC_OPTIONS.uploads,
			SYNC_OPTIONS.contents,
		];

		syncOptionOrder.forEach( ( syncOption ) => {
			if ( syncOptionGroups[ syncOption ] ) {
				optionsToSync.push( syncOption );
			}
		} );

		// Extract specific selections for plugins, themes, uploads
		specificSelections = extractSpecificSelections( selectedPaths );
	}

	return {
		optionsToSync,
		specificSelections,
	};
};

export const convertTreeToPullOptions = ( tree: TreeNode[] ): PullSiteOptions => {
	const { isDatabaseSelected, filesAndFolders, wpContent } = getCommonNodes( tree );

	if ( ! filesAndFolders || ! isDatabaseSelected ) {
		throw new Error(
			'Error when converting tree to pull options. Database or files and folders not found'
		);
	}

	if ( isDatabaseSelected.checked && filesAndFolders.checked ) {
		return {
			optionsToSync: [ SYNC_OPTIONS.all ],
		};
	}

	const pathIds = collectPathIds( wpContent?.children ?? [] );

	const pullOptions: PullSiteOptions = {
		optionsToSync: pathIds.length > 0 ? [ SYNC_OPTIONS.paths ] : [],
	};

	if ( pathIds.length > 0 ) {
		pullOptions.include_path_list = pathIds;
	}

	if ( isDatabaseSelected.checked ) {
		pullOptions.optionsToSync.push( SYNC_OPTIONS.sqls );
	}

	return pullOptions;
};
