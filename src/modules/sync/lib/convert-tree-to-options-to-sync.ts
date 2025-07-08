import { CONTENTS_SYNC_OPTIONS, SYNC_OPTIONS } from 'src/constants';
import type { TreeNode } from 'src/components/tree-view';
import type { ContentsSyncOption, SyncOption } from 'src/types';

type SyncOptionsWithSelections = {
	optionsToSync: SyncOption[];
	specificSelections?: {
		plugins?: string[];
		themes?: string[];
		uploads?: string[];
		'mu-plugins'?: string[];
		fonts?: string[];
	};
};

const isSyncOption = ( value: string ): value is SyncOption => {
	return Object.keys( SYNC_OPTIONS ).includes( value );
};

const isContentsSyncOption = ( value: string ): value is ContentsSyncOption => {
	return Object.keys( CONTENTS_SYNC_OPTIONS ).includes( value );
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
			if ( ! isSyncOption( item.id ) && ! isContentsSyncOption( item.id ) ) {
				return;
			}

			if ( item.checked || item.indeterminate ) {
				const itemId = isContentsSyncOption( item.id ) ? SYNC_OPTIONS.contents : item.id;
				optionsToSync.push( itemId );
			}

			if (
				item.children &&
				[
					SYNC_OPTIONS.plugins,
					SYNC_OPTIONS.themes,
					SYNC_OPTIONS.uploads,
					CONTENTS_SYNC_OPTIONS[ 'mu-plugins' ],
					CONTENTS_SYNC_OPTIONS.fonts,
				].includes( item.id as 'plugins' | 'themes' | 'uploads' | 'mu-plugins' | 'fonts' )
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

	console.log( 'optionsToSync', optionsToSync );
	console.log( 'specificSelections', specificSelections );

	return {
		optionsToSync,
		specificSelections,
	};
};
