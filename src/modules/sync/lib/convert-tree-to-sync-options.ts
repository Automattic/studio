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

const iterateOverCheckedNodes = (
	nodes: TreeNode[] | undefined,
	visit: ( node: TreeNode ) => void
): void => {
	if ( ! nodes?.length ) return;
	for ( const node of nodes ) {
		if ( node.checked ) {
			visit( node );
		} else if ( node.indeterminate && node.children?.length ) {
			iterateOverCheckedNodes( node.children, visit );
		}
	}
};

const collectPathIds = ( nodes: TreeNode[] | undefined ): string[] => {
	const out: string[] = [];
	iterateOverCheckedNodes( nodes, ( node ) => {
		if ( node.pathId ) out.push( node.pathId );
	} );
	return out;
};

type Category = {
	files: Set< string >;
	option: SyncOption;
};

const convertTreeToSyncCategories = ( nodes: TreeNode[] | undefined ): Category[] => {
	const categories = {
		plugins: { files: new Set< string >(), option: SYNC_OPTIONS.plugins },
		themes: { files: new Set< string >(), option: SYNC_OPTIONS.themes },
		uploads: { files: new Set< string >(), option: SYNC_OPTIONS.uploads },
		contents: { files: new Set< string >(), option: SYNC_OPTIONS.contents },
	};

	iterateOverCheckedNodes( nodes, ( node ) => {
		if ( ! node.path ) return;

		const p = node.path.replace( /^\/?wp-content\//, '' );

		if ( p.startsWith( 'plugins/' ) ) {
			categories.plugins.files.add( p );
		} else if ( p.startsWith( 'themes/' ) ) {
			categories.themes.files.add( p );
		} else if ( p.startsWith( 'uploads/' ) ) {
			categories.uploads.files.add( p );
		} else if (
			p.startsWith( 'mu-plugins/' ) ||
			p.startsWith( 'languages/' ) ||
			p.startsWith( 'fonts/' ) ||
			! p.includes( '/' )
		) {
			categories.contents.files.add( p );
		}
	} );

	return Object.values( categories );
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

		for ( const { files, option } of categories ) {
			if ( files.size ) {
				optionsToSync.push( option );
				specificSelections[ option as 'plugins' | 'themes' | 'uploads' | 'contents' ] = [
					...files,
				];
			}
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
