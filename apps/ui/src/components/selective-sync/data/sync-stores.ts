import { backupLsItemSchema } from '@studio/common/types/sync-tree';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { SYNC_OPTIONS } from '@/components/selective-sync/lib/constants';
import { getIpcApi } from '@/components/selective-sync/lib/get-ipc-api';
import { convertRawToTreeNodes } from '@/components/selective-sync/lib/tree-utils';
import { useConnector } from '@/data/core';
import type { SyncOption } from '@/components/selective-sync/lib/types';
import type { TreeNode } from '@/components/selective-sync/tree-view';
import type { BackupLsItem } from '@studio/common/types/sync-tree';

// Adapters replacing the legacy renderer's Redux sync hooks
// (src/stores/sync/sync-hooks.ts) with TanStack Query over the connector.
// Hook signatures and return shapes mirror the originals so the copied
// `sync-dialog.tsx` works unchanged.

// Mirrors the legacy `PullSiteOptions` from
// apps/studio/src/stores/sync/sync-operations-slice.ts.
export type PullSiteOptions = {
	optionsToSync: SyncOption[];
	include_path_list?: string[];
};

const getParentFolder = ( parentPath: string ) => {
	return parentPath.split( '/' ).filter( Boolean ).pop() ?? '';
};

// Copied verbatim from apps/studio/src/stores/sync/sync-api.ts.
const convertBackupItemToTreeNode = (
	name: string,
	item: BackupLsItem,
	parentPath: string,
	parentChecked: boolean = false
): TreeNode => {
	const fullPath = parentPath.endsWith( '/' )
		? `${ parentPath }${ name }/`
		: `${ parentPath }/${ name }/`;

	const isFolder = item.type === 'dir' || item.has_children === true;

	const isPlugin =
		( isFolder && getParentFolder( parentPath ) === SYNC_OPTIONS.plugins ) ||
		getParentFolder( parentPath ) === 'mu-plugins';
	const isTheme = isFolder && getParentFolder( parentPath ) === SYNC_OPTIONS.themes;

	let type: TreeNode[ 'type' ] = 'file';
	if ( isPlugin ) {
		type = 'plugin';
	} else if ( isTheme ) {
		type = 'theme';
	} else if ( isFolder ) {
		type = 'folder';
	}

	return {
		id: item.id,
		name,
		label: name,
		checked: parentChecked,
		type,
		pathId: item.id,
		path: fullPath,
		loading: false,
		children: isFolder ? [] : undefined,
		expanded: false,
		hideExpandButton: isPlugin || isTheme,
	};
};

export function useLatestRewindId(
	remoteSiteId: number | undefined,
	options?: {
		skip: boolean;
	}
) {
	const { skip = false } = options || {};
	const connector = useConnector();

	const {
		data: rewindId,
		isLoading,
		error,
	} = useQuery( {
		queryKey: [ 'selectiveSync', 'latestRewindId', remoteSiteId ],
		queryFn: () => connector.getLatestRewindId( remoteSiteId as number ),
		enabled: Boolean( remoteSiteId ) && ! skip,
	} );

	return {
		rewindId: rewindId || null,
		isLoading,
		isError: Boolean( error ),
	};
}

export function useHostingPhpVersion(
	remoteSiteId: number | undefined,
	options?: {
		skip: boolean;
	}
) {
	const { skip = false } = options || {};
	const connector = useConnector();

	const {
		data: phpVersion,
		isLoading,
		error,
	} = useQuery( {
		queryKey: [ 'selectiveSync', 'hostingPhpVersion', remoteSiteId ],
		queryFn: () => connector.getHostingPhpVersion( remoteSiteId as number ),
		enabled: Boolean( remoteSiteId ) && ! skip,
	} );

	return {
		phpVersion,
		isLoading,
		isError: Boolean( error ),
	};
}

export function useRemoteFileTree() {
	const connector = useConnector();
	const [ isLoading, setIsLoading ] = useState( false );
	const [ error, setError ] = useState< Error | null >( null );

	const fetchChildren = useCallback(
		async (
			remoteSiteId: number,
			rewindId: string,
			path: string,
			parentChecked: boolean = false
		): Promise< TreeNode[] > => {
			setIsLoading( true );
			setError( null );
			try {
				const contents = await connector.listRemoteFileTree( remoteSiteId, rewindId, path );

				const children: TreeNode[] = [];
				for ( const [ name, rawItem ] of Object.entries( contents ) ) {
					const itemValidation = backupLsItemSchema.safeParse( rawItem );
					if ( itemValidation.success ) {
						const node = convertBackupItemToTreeNode(
							name,
							itemValidation.data,
							path,
							parentChecked
						);
						children.push( node );
					} else {
						console.warn( `Invalid item format for ${ name }:`, itemValidation.error );
					}
				}
				return children;
			} catch ( err ) {
				const errorInstance =
					err instanceof Error ? err : new Error( 'Failed to fetch remote file tree' );
				setError( errorInstance );
				throw errorInstance;
			} finally {
				setIsLoading( false );
			}
		},
		[ connector ]
	);

	return {
		isLoading,
		error,
		fetchChildren,
	};
}

export function useLocalFileTree() {
	const [ isLoading, setIsLoading ] = useState( false );
	const [ error, setError ] = useState< Error | null >( null );

	const fetchChildren = useCallback(
		async ( siteId: string, path: string = 'wp-content' ): Promise< TreeNode[] > => {
			setIsLoading( true );
			setError( null );
			try {
				const rawNodes = await getIpcApi().listLocalFileTree( siteId, path, 3 );
				return convertRawToTreeNodes( rawNodes );
			} catch ( err ) {
				const error = err instanceof Error ? err : new Error( String( err ) );
				setError( error );
				console.error( 'Failed to fetch local file tree:', error );
				return [];
			} finally {
				setIsLoading( false );
			}
		},
		[]
	);

	return {
		fetchChildren,
		isLoading,
		error,
	};
}
