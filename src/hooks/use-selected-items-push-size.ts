import { useState, useEffect, useCallback } from 'react';
import { TreeNode } from 'src/components/tree-view';
import { SYNC_PUSH_SIZE_LIMIT_BYTES } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';

export function useSelectedItemsPushSize(
	siteId: string,
	treeState: TreeNode[],
	type: 'push' | 'pull'
) {
	const [ isPushSelectionOverLimit, setIsPushSelectionOverLimit ] = useState( false );
	const [ isLoading, setIsLoading ] = useState( false );

	const checkSelectedItemsSize = useCallback( async () => {
		if ( ! siteId || ! treeState.length || type !== 'push' ) {
			setIsPushSelectionOverLimit( false );
			return;
		}

		setIsLoading( true );

		try {
			const isEverythingSelected = treeState.every( ( node ) => node.checked );

			if ( isEverythingSelected ) {
				const size = await getIpcApi().getDirectorySize( siteId, [ 'wp-content' ] );
				setIsPushSelectionOverLimit( size > SYNC_PUSH_SIZE_LIMIT_BYTES );
				return;
			}

			const sizePromises: Promise< number >[] = [];

			const databaseNode = treeState.find( ( node ) => node.id === 'sqls' );
			if ( databaseNode?.checked ) {
				sizePromises.push( getIpcApi().getDirectorySize( siteId, [ 'wp-content', 'database' ] ) );
			}

			const filesAndFoldersNode = treeState.find( ( node ) => node.id === 'filesAndFolders' );
			const wpContentNode = filesAndFoldersNode?.children?.find(
				( node ) => node.id === 'wp-content'
			);

			if ( wpContentNode?.checked ) {
				sizePromises.push( getIpcApi().getDirectorySize( siteId, [ 'wp-content' ] ) );
			} else if ( wpContentNode?.children ) {
				for ( const child of wpContentNode.children ) {
					if ( child.checked ) {
						sizePromises.push(
							getIpcApi().getDirectorySize( siteId, [ 'wp-content', child.name ] )
						);
					} else if ( child.indeterminate && child.children ) {
						for ( const subChild of child.children ) {
							if ( subChild.checked || subChild.indeterminate ) {
								sizePromises.push(
									getIpcApi().getDirectorySize( siteId, [
										'wp-content',
										child.name,
										subChild.name,
									] )
								);
							}
						}
					}
				}
			}

			if ( sizePromises.length > 0 ) {
				const sizes = await Promise.all( sizePromises );
				const totalSize = sizes.reduce( ( sum, size ) => sum + size, 0 );
				setIsPushSelectionOverLimit( totalSize > SYNC_PUSH_SIZE_LIMIT_BYTES );
			} else {
				setIsPushSelectionOverLimit( false );
			}
		} catch ( error ) {
			console.error( 'Error checking selected items size:', error );
			setIsPushSelectionOverLimit( false );
		} finally {
			setIsLoading( false );
		}
	}, [ siteId, treeState, type ] );

	// Check size when siteId or treeState changes
	useEffect( () => {
		void checkSelectedItemsSize();
	}, [ checkSelectedItemsSize ] );

	return { isPushSelectionOverLimit, isLoading };
}
