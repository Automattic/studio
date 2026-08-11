import { shouldLimitDepth } from '@studio/common/lib/sync/tree-utils';
import { TreeNode } from '@/components/selective-sync/tree-view';
import type { RawDirectoryEntry } from '@studio/common/types/sync-tree';

export const convertRawToTreeNodes = ( rawNodes: RawDirectoryEntry[] ): TreeNode[] => {
	const pluginRegex = /^plugins\/[^/]+$/;
	const themeRegex = /^themes\/[^/]+$/;
	const pathCleanRegex = /[^a-zA-Z0-9/]/g;
	return rawNodes
		.map( ( rawNode ) => {
			let nodeType: 'file' | 'folder' | 'plugin' | 'theme' = rawNode.isDirectory
				? 'folder'
				: 'file';
			if ( rawNode.isDirectory ) {
				const normalizedPath = rawNode.path.replace( /^wp-content\//, '' );
				if ( pluginRegex.test( normalizedPath ) ) {
					nodeType = 'plugin';
				} else if ( themeRegex.test( normalizedPath ) ) {
					nodeType = 'theme';
				}
			}

			let children: TreeNode[] | undefined;
			if ( rawNode.children ) {
				children = convertRawToTreeNodes( rawNode.children );
			} else if ( rawNode.isDirectory ) {
				children = [];
			} else {
				children = undefined;
			}

			return {
				id: `local-${ rawNode.path.replace( pathCleanRegex, '-' ) }`,
				name: rawNode.name,
				label: rawNode.name,
				checked: false,
				type: nodeType,
				path: rawNode.path,
				pathId: rawNode.path,
				children,
				expanded: false,
				hideExpandButton: shouldLimitDepth( rawNode.path ),
			};
		} )
		.sort( ( a, b ) => {
			if ( a.type !== b.type ) {
				const typeOrder = { folder: 0, plugin: 1, theme: 2, file: 3 };
				return typeOrder[ a.type ] - typeOrder[ b.type ];
			}
			return a.name.toLowerCase().localeCompare( b.name.toLowerCase() );
		} );
};
