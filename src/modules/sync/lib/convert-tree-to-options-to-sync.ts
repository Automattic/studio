import { SYNC_OPTIONS } from 'src/constants';
import type { TreeNode } from 'src/components/tree-view';
import type { SyncOption } from 'src/types';

type SyncOptionsWithSelections = {
	optionsToSync: SyncOption[];
	specificSelections?: {
		plugins?: string[];
		themes?: string[];
		uploads?: string[];
	};
};

const isSyncOption = ( value: string ): value is SyncOption => {
	return Object.keys( SYNC_OPTIONS ).includes( value );
};

export const convertTreeToOptionsToSync = ( tree: TreeNode[] ): SyncOptionsWithSelections => {
	const optionsToSync: SyncOption[] = [];
	let specificSelections: SyncOptionsWithSelections[ 'specificSelections' ] = undefined;

	const isAll = tree.every( ( node ) => node.checked );
	if ( isAll ) {
		optionsToSync.push( SYNC_OPTIONS.all );
	} else {
		const isDatabaseSelected = tree.find( ( node ) => node.id === SYNC_OPTIONS.sqls )?.checked;

		if ( isDatabaseSelected ) {
			optionsToSync.push( SYNC_OPTIONS.sqls );
		}

		const filesAndFolders = tree.find( ( node ) => node.id === 'filesAndFolders' )?.children || [];
		const wpContent = filesAndFolders.find( ( node ) => node.id === 'wp-content' )?.children || [];

		wpContent.forEach( ( item ) => {
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
