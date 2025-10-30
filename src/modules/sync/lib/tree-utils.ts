import { TreeNode } from 'src/components/tree-view';
import { SYNC_EXCLUSIONS } from '../constants';
import type { RawFileNode } from '../types';

export const shouldExcludeFromSync = ( itemName: string ): boolean => {
	if ( itemName.startsWith( '.' ) ) {
		return true;
	}

	if ( SYNC_EXCLUSIONS.includes( itemName ) ) {
		return true;
	}

	return false;
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

	return false;
};

export const convertRawToTreeNodes = (
	rawNodes: RawFileNode[],
	parentChecked: boolean = false
): TreeNode[] => {
	const pluginRegex = /^plugins\/[^/]+$/;
	const themeRegex = /^themes\/[^/]+$/;
	const pathCleanRegex = /[^a-zA-Z0-9]/g;
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

			const children = rawNode.children
				? convertRawToTreeNodes( rawNode.children, parentChecked )
				: rawNode.isDirectory
				? []
				: undefined;

			return {
				id: `local-${ rawNode.path.replace( pathCleanRegex, '-' ) }`,
				name: rawNode.name,
				label: rawNode.name,
				checked: parentChecked,
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
				return a.type === 'folder' ? -1 : 1;
			}
			return a.name.toLowerCase().localeCompare( b.name.toLowerCase() );
		} );
};
