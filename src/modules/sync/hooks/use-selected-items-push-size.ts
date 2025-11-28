import { useState, useEffect, useCallback } from 'react';
import { TreeNode } from 'src/components/tree-view';
import { SYNC_PUSH_SIZE_LIMIT_BYTES, SYNC_PUSH_SIZE_LIMIT_GB } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';

const formatFileSize = ( bytes: number ) => {
	if ( bytes === 0 ) return '0 B';
	const k = 1024;
	const sizes = [ 'B', 'KB', 'MB', 'GB' ];
	const i = Math.floor( Math.log( bytes ) / Math.log( k ) );
	return Math.round( ( bytes / Math.pow( k, i ) ) * 100 ) / 100 + ' ' + sizes[ i ];
};

export function useSelectedItemsPushSize(
	siteId: string,
	treeState: TreeNode[],
	type: 'push' | 'pull'
) {
	const [ isPushSelectionOverLimit, setIsPushSelectionOverLimit ] = useState( false );
	const [ isLoading, setIsLoading ] = useState( false );
	const [ totalSize, setTotalSize ] = useState( 0 );

	const checkSelectedItemsSize = useCallback( async () => {
		if ( ! siteId || ! treeState.length || type !== 'push' ) {
			setIsPushSelectionOverLimit( false );
			setTotalSize( 0 );
			return;
		}

		setIsLoading( true );

		try {
			const isEverythingSelected = treeState.every( ( node ) => node.checked );

			if ( isEverythingSelected ) {
				const size = await getIpcApi().getDirectorySize( siteId, [ 'wp-content' ] );
				setTotalSize( size );
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

			const processNodeRecursively = ( node: TreeNode, pathPrefix: string[] ): void => {
				if ( node.checked ) {
					// If the node is fully checked, get its entire size
					if ( node.type === 'file' ) {
						sizePromises.push( getIpcApi().getFileSize( siteId, [ ...pathPrefix, node.name ] ) );
					} else {
						if ( node.name === 'mu-plugins' && ! node.children?.length ) {
							// Skip the calculation if whole mu-plugins folder is selected and it doesn't have any children
							return;
						}
						sizePromises.push(
							getIpcApi().getDirectorySize( siteId, [ ...pathPrefix, node.name ] )
						);
					}
				} else if ( node.indeterminate && node.children ) {
					// If the node is indeterminate, process its children recursively
					for ( const child of node.children ) {
						processNodeRecursively( child, [ ...pathPrefix, node.name ] );
					}
				}
			};

			if ( wpContentNode ) {
				processNodeRecursively( wpContentNode, [] );
			}

			if ( sizePromises.length > 0 ) {
				const sizes = await Promise.all( sizePromises );
				const calculatedSize = sizes.reduce( ( sum, size ) => sum + size, 0 );
				setTotalSize( calculatedSize );
				setIsPushSelectionOverLimit( calculatedSize > SYNC_PUSH_SIZE_LIMIT_BYTES );
			} else {
				setTotalSize( 0 );
				setIsPushSelectionOverLimit( false );
			}
		} catch ( error ) {
			console.error( 'Error checking selected items size:', error );
			setIsPushSelectionOverLimit( false );
			setTotalSize( 0 );
		} finally {
			setIsLoading( false );
		}
	}, [ siteId, treeState, type ] );

	// Check size when siteId or treeState changes
	useEffect( () => {
		void checkSelectedItemsSize();
	}, [ checkSelectedItemsSize ] );

	const limitBytes = SYNC_PUSH_SIZE_LIMIT_GB * 1024 * 1024 * 1024;
	const overAmount = totalSize > limitBytes ? totalSize - limitBytes : 0;

	return {
		isPushSelectionOverLimit,
		isLoading,
		totalSize,
		limitBytes,
		formattedSize: formatFileSize( totalSize ),
		formattedLimit: formatFileSize( limitBytes ),
		formattedOverAmount: formatFileSize( overAmount ),
	};
}
