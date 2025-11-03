import { SYNC_OPTIONS } from 'src/constants';
import { PullSiteOptions } from 'src/hooks/sync-sites/use-sync-pull';
import type { TreeNode } from 'src/components/tree-view';
import type { SyncOption } from 'src/types';

type PushOptionsWithSelections = {
	optionsToSync: SyncOption[];
	specificSelections?: {
		plugins?: string[];
		themes?: string[];
		uploads?: string[];
		contents?: string[];
	};
};

const STANDARD_CATEGORIES = [
	{ prefix: 'plugins/', key: 'plugins' as const, option: SYNC_OPTIONS.plugins },
	{ prefix: 'themes/', key: 'themes' as const, option: SYNC_OPTIONS.themes },
	{ prefix: 'uploads/', key: 'uploads' as const, option: SYNC_OPTIONS.uploads },
] as const;

const CONTENTS_ROOTS = [ 'mu-plugins', 'fonts', 'languages' ] as const;

const normalizePath = ( path: string ): string =>
	path.replace( /^\/?wp-content\//, '' ).replace( /^\/+|\/+$/g, '' );

const traverseSelected = (
	nodes: TreeNode[] | undefined,
	visit: ( node: TreeNode ) => void
): void => {
	if ( ! nodes?.length ) return;
	for ( const node of nodes ) {
		if ( node.checked ) {
			visit( node );
		} else if ( node.indeterminate && node.children?.length ) {
			traverseSelected( node.children, visit );
		}
	}
};

const collectPathIds = ( nodes: TreeNode[] | undefined ): string[] => {
	const out: string[] = [];
	traverseSelected( nodes, ( node ) => {
		if ( node.pathId ) out.push( node.pathId );
	} );
	return out;
};

type Categories = {
	plugins: Set< string >;
	themes: Set< string >;
	uploads: Set< string >;
	contents: Set< string >;
};

const convertTreeToSyncCategories = ( nodes: TreeNode[] | undefined ): Categories => {
	const categories: Categories = {
		plugins: new Set< string >(),
		themes: new Set< string >(),
		uploads: new Set< string >(),
		contents: new Set< string >(),
	};

	traverseSelected( nodes, ( node ) => {
		if ( ! node.path ) return;

		const p = normalizePath( node.path );

		// Check standard categories
		for ( const { prefix, key } of STANDARD_CATEGORIES ) {
			if ( p.startsWith( prefix ) ) {
				const rel = p.slice( prefix.length );
				if ( rel ) categories[ key ].add( rel );
				return;
			}
		}

		const isContents =
			CONTENTS_ROOTS.some( ( root ) => p === root || p.startsWith( `${ root }/` ) ) ||
			! p.includes( '/' );

		if ( isContents ) categories.contents.add( p );
	} );

	return categories;
};

const getCommonNodes = ( tree: TreeNode[] ) => {
	let isDatabaseSelected: TreeNode | undefined;
	let filesAndFolders: TreeNode | undefined;

	for ( const node of tree ) {
		if ( node.id === SYNC_OPTIONS.sqls ) isDatabaseSelected = node;
		else if ( node.id === 'filesAndFolders' ) filesAndFolders = node;
	}

	const wpContent = filesAndFolders?.children?.find( ( n ) => n.id === 'wp-content' );

	return { isDatabaseSelected, filesAndFolders, wpContent };
};

export const convertTreeToPushOptions = ( tree: TreeNode[] ): PushOptionsWithSelections => {
	const optionsToSync: SyncOption[] = [];
	const specificSelections: NonNullable< PushOptionsWithSelections[ 'specificSelections' ] > = {};

	if ( tree.length > 0 && tree.every( ( node ) => node.checked ) ) {
		optionsToSync.push( SYNC_OPTIONS.all );
		return { optionsToSync, specificSelections: undefined };
	}

	const { isDatabaseSelected, wpContent } = getCommonNodes( tree );

	if ( isDatabaseSelected?.checked ) {
		optionsToSync.push( SYNC_OPTIONS.sqls );
	}

	if ( wpContent?.children?.length ) {
		const categories = convertTreeToSyncCategories( wpContent.children );

		for ( const { key, option } of STANDARD_CATEGORIES ) {
			if ( categories[ key ].size ) {
				optionsToSync.push( option );
				specificSelections[ key ] = [ ...categories[ key ] ];
			}
		}
		if ( categories.contents.size ) {
			optionsToSync.push( SYNC_OPTIONS.contents );
			specificSelections.contents = [ ...categories.contents ];
		}
	}

	return {
		optionsToSync,
		specificSelections: Object.keys( specificSelections ).length ? specificSelections : undefined,
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
		optionsToSync: isDatabaseSelected.checked ? [ SYNC_OPTIONS.sqls ] : [],
	};

	if ( pathIds.length > 0 ) {
		pullOptions.optionsToSync.unshift( SYNC_OPTIONS.paths );
		pullOptions.include_path_list = pathIds;
	}

	return pullOptions;
};
