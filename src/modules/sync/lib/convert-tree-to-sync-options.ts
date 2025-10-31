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

const normalizePath = ( path: string ): string =>
	path.replace( /^wp-content\//, '' ).replace( /^\/+|\/+$/g, '' );

const PATH_SYNC_MAP = [
	{ pattern: /^plugins\//, option: SYNC_OPTIONS.plugins },
	{ pattern: /^themes\//, option: SYNC_OPTIONS.themes },
	{ pattern: /^uploads\//, option: SYNC_OPTIONS.uploads },
	{ pattern: /^(mu-plugins|fonts|languages)(\/|$)/, option: SYNC_OPTIONS.contents },
] as const;

const SPECIFIC_PATTERNS = {
	plugins: /^plugins\/([^/]+)/,
	themes: /^themes\/([^/]+)/,
	uploads: /^uploads\/([^/]+)/,
} as const;

const shouldExcludePathFromSync = ( path: string ): boolean => {
	const normalizedPath = normalizePath( path );

	for ( const exclusion of SYNC_EXCLUSIONS ) {
		if ( normalizedPath === exclusion || normalizedPath.startsWith( exclusion ) ) {
			return true;
		}
	}

	return false;
};

const getPathSyncOption = ( path: string ): SyncOption | null => {
	const normalizedPath = normalizePath( path );

	for ( const { pattern, option } of PATH_SYNC_MAP ) {
		if ( pattern.test( normalizedPath ) ) {
			return option;
		}
	}

	if ( normalizedPath ) {
		return SYNC_OPTIONS.contents;
	}

	return null;
};

const collectNodes = < T >( nodes: TreeNode[], extractor: ( node: TreeNode ) => T | null ): T[] => {
	const collector: T[] = [];
	nodes.forEach( ( node ) => {
		if ( node.checked ) {
			const value = extractor( node );
			if ( value ) collector.push( value );
		} else if ( node.indeterminate && node.children ) {
			collector.push( ...collectNodes( node.children, extractor ) );
		}
	} );
	return collector;
};

const collectPathIds = ( nodes: TreeNode[] ): string[] =>
	collectNodes( nodes, ( node ) => node.pathId || null );

const collectSelectedPaths = ( nodes: TreeNode[] ): string[] =>
	collectNodes( nodes, ( node ) =>
		node.path && ! shouldExcludePathFromSync( node.path ) ? node.path : null
	);

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
	const collections = {
		plugins: new Set< string >(),
		themes: new Set< string >(),
		uploads: new Set< string >(),
	};

	paths.forEach( ( path ) => {
		const normalizedPath = normalizePath( path );

		Object.entries( SPECIFIC_PATTERNS ).forEach( ( [ key, pattern ] ) => {
			const match = normalizedPath.match( pattern );
			if ( match ) {
				collections[ key as keyof typeof collections ].add( match[ 1 ] );
			}
		} );
	} );

	Object.entries( collections ).forEach( ( [ key, set ] ) => {
		if ( set.size > 0 ) {
			specificSelections[ key as keyof typeof collections ] = Array.from( set );
		}
	} );

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

	let specificSelections: PushOptionsWithSelections[ 'specificSelections' ] = undefined;

	if ( wpContent?.children?.length ) {
		const selectedPaths = collectSelectedPaths( wpContent.children );
		const syncOptionGroups = groupPathsBySyncOption( selectedPaths );

		PATH_SYNC_MAP.forEach( ( { option } ) => {
			if ( syncOptionGroups[ option ] ) {
				optionsToSync.push( option );
			}
		} );

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
