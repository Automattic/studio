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

const normalizePath = ( path: string ): string =>
	path.replace( /^wp-content\//, '' ).replace( /^\/+|\/+$/g, '' );

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
	collectNodes( nodes, ( node ) => node.path || null );

const categorizeSelectedPaths = ( paths: string[] ) => {
	const categories = {
		plugins: new Set< string >(),
		themes: new Set< string >(),
		uploads: new Set< string >(),
		contents: new Set< string >(),
	};

	paths.forEach( ( path ) => {
		const normalizedPath = normalizePath( path );

		const standardCategories = [ 'plugins', 'themes', 'uploads' ] as const;
		for ( const category of standardCategories ) {
			if ( normalizedPath.startsWith( `${ category }/` ) ) {
				const relativePath = normalizedPath.substring( category.length + 1 );
				if ( relativePath ) categories[ category ].add( relativePath );
				return;
			}
		}

		const contentsPatterns = [ 'mu-plugins', 'fonts', 'languages' ];
		const isContentsPath =
			contentsPatterns.some(
				( p ) => normalizedPath.startsWith( `${ p }/` ) || normalizedPath === p
			) || ! normalizedPath.includes( '/' );

		if ( isContentsPath ) {
			categories.contents.add( normalizedPath );
		}
	} );

	return categories;
};

const getCommonNodes = ( tree: TreeNode[] ) => {
	const isDatabaseSelected = tree.find( ( node ) => node.id === SYNC_OPTIONS.sqls );
	const filesAndFolders = tree.find( ( node ) => node.id === 'filesAndFolders' );
	const wpContent = filesAndFolders?.children?.find( ( node ) => node.id === 'wp-content' );

	return { isDatabaseSelected, filesAndFolders, wpContent };
};

export const convertTreeToPushOptions = ( tree: TreeNode[] ): PushOptionsWithSelections => {
	const optionsToSync: SyncOption[] = [];
	const specificSelections: PushOptionsWithSelections[ 'specificSelections' ] = {};

	const isAll = tree.every( ( node ) => node.checked );
	if ( isAll ) {
		optionsToSync.push( SYNC_OPTIONS.all );
		return { optionsToSync, specificSelections: undefined };
	}

	const { isDatabaseSelected, wpContent } = getCommonNodes( tree );

	if ( isDatabaseSelected?.checked ) {
		optionsToSync.push( SYNC_OPTIONS.sqls );
	}

	if ( wpContent?.children?.length ) {
		const selectedPaths = collectSelectedPaths( wpContent.children );
		const categories = categorizeSelectedPaths( selectedPaths );

		const categoryMap = [
			{ category: 'plugins' as const, option: SYNC_OPTIONS.plugins },
			{ category: 'themes' as const, option: SYNC_OPTIONS.themes },
			{ category: 'uploads' as const, option: SYNC_OPTIONS.uploads },
			{ category: 'contents' as const, option: SYNC_OPTIONS.contents },
		];

		categoryMap.forEach( ( { category, option } ) => {
			if ( categories[ category ].size > 0 ) {
				optionsToSync.push( option );
				specificSelections[ category ] = Array.from( categories[ category ] );
			}
		} );
	}

	return {
		optionsToSync,
		specificSelections:
			Object.keys( specificSelections ).length > 0 ? specificSelections : undefined,
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
