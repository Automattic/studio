import { TreeNode } from 'src/components/tree-view';
import type { RawDirectoryEntry } from '../types';
import type { Ignore } from '@studio/common/lib/deploy-ignore';

export const shouldExcludeFromSync = ( relativePath: string, deployIgnore: Ignore ): boolean => {
	const itemName = relativePath.split( '/' ).pop() || '';
	if ( itemName.startsWith( '.' ) ) {
		return true;
	}
	return deployIgnore.ignores( relativePath );
};

export const shouldLimitDepth = ( relativePath: string ): boolean => {
	const normalizedPath = relativePath.replace( /^wp-content\//, '' );

	// Match plugins/plugin-name or plugins/plugin-name/
	if ( normalizedPath.match( /^plugins\/[^/]+\/?$/ ) ) {
		return true;
	}

	// Match themes/theme-name or themes/theme-name/
	if ( normalizedPath.match( /^themes\/[^/]+\/?$/ ) ) {
		return true;
	}

	// Match mu-plugins/mu-plugin or mu-plugins/mu-plugin/
	if ( normalizedPath.match( /^mu-plugins\/[^/]+\/?$/ ) ) {
		return true;
	}

	return false;
};

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
