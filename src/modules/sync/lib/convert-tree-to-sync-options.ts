import { SYNC_OPTIONS } from 'src/constants';
import { PullSiteOptions } from 'src/hooks/sync-sites/use-sync-pull';
import type { TreeNode } from 'src/components/tree-view';
import type { SyncOption } from 'src/types';

// Types
type PushOptionsWithSelections = {
	optionsToSync: SyncOption[];
	specificSelections?: {
		plugins?: string[];
		themes?: string[];
		uploads?: string[];
	};
};

// Shared utilities
const isSyncOption = ( value: string ): value is SyncOption => {
	return Object.keys( SYNC_OPTIONS ).includes( value );
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

const getCommonNodes = ( tree: TreeNode[] ) => {
	const isDatabaseSelected = tree.find( ( node ) => node.id === SYNC_OPTIONS.sqls );
	const filesAndFolders = tree.find( ( node ) => node.id === 'filesAndFolders' );
	const wpContent = filesAndFolders?.children?.find( ( node ) => node.id === 'wp-content' );

	return { isDatabaseSelected, filesAndFolders, wpContent };
};

// Push conversion
export const convertTreeToPushOptions = ( tree: TreeNode[] ): PushOptionsWithSelections => {
	const optionsToSync: SyncOption[] = [];
	let specificSelections: PushOptionsWithSelections[ 'specificSelections' ] = undefined;

	const isAll = tree.every( ( node ) => node.checked );
	if ( isAll ) {
		optionsToSync.push( SYNC_OPTIONS.all );
	} else {
		const { isDatabaseSelected, wpContent } = getCommonNodes( tree );

		if ( isDatabaseSelected?.checked ) {
			optionsToSync.push( SYNC_OPTIONS.sqls );
		}

		const wpContentChildren = wpContent?.children || [];
		wpContentChildren.forEach( ( item ) => {
			if ( ! isSyncOption( item.id ) ) {
				return;
			}

			if ( item.checked || item.indeterminate ) {
				optionsToSync.push( item.id );
			}

			if (
				item.children &&
				[ SYNC_OPTIONS.plugins, SYNC_OPTIONS.themes, SYNC_OPTIONS.uploads ].includes(
					item.id as 'plugins' | 'themes' | 'uploads'
				)
			) {
				const selectedItems = item.children
					.filter( ( child ) => child.checked )
					.map( ( child ) => child.name );
				if ( selectedItems.length > 0 && selectedItems.length < item.children.length ) {
					specificSelections = {
						...specificSelections,
						[ item.id ]: selectedItems,
					};
				}
			}
		} );
	}

	return {
		optionsToSync,
		specificSelections,
	};
};

// Pull conversion
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
		optionsToSync: pathIds.length > 0 ? [ SYNC_OPTIONS.paths ] : []
	};

	if ( pathIds.length > 0 ) {
		pullOptions.include_path_list = pathIds;
	}

	if ( isDatabaseSelected.checked ) {
		pullOptions.optionsToSync.push( SYNC_OPTIONS.sqls );
	}

	return pullOptions;
};
