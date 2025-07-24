import { useCallback, useState } from 'react';
import { TreeNode } from 'src/components/tree-view';
import { SYNC_OPTIONS } from 'src/constants';
import { useAuth } from 'src/hooks/use-auth';
import { BackupLsItemSchema, BackupLsResponseSchema } from './types';
import type { BackupLsItem, BackupLsRequest } from './types';

interface UseRemoteFileTreeResult {
	isLoading: boolean;
	error: Error | null;
	fetchChildren: (
		remoteSiteId: number,
		rewindId: string,
		path: string
	) => Promise< TreeNode[] | null >;
}

const mapItemTypeToSyncOption = ( name: string ): string => {
	switch ( name ) {
		case 'themes':
			return SYNC_OPTIONS.themes;
		case 'plugins':
			return SYNC_OPTIONS.plugins;
		case 'uploads':
			return SYNC_OPTIONS.uploads;
		default:
			return name;
	}
};

const convertBackupItemToTreeNode = (
	name: string,
	item: BackupLsItem,
	parentPath: string
): TreeNode => {
	const nodeId = mapItemTypeToSyncOption( name );
	const fullPath = parentPath.endsWith( '/' )
		? `${ parentPath }${ name }/`
		: `${ parentPath }/${ name }/`;

	const isFolder = item.type === 'dir' || item.has_children === true;
	return {
		id: nodeId,
		name,
		label: name,
		checked: true,
		type: isFolder ? 'folder' : 'file',
		pathId: item.id,
		path: fullPath,
		loading: false,
		children: isFolder ? [] : undefined,
		expanded: false,
	};
};

export function useRemoteFileTree(): UseRemoteFileTreeResult {
	const { client } = useAuth();
	const [ isLoading, setIsLoading ] = useState( false );
	const [ error, setError ] = useState< Error | null >( null );

	const fetchDirectoryContents = useCallback(
		async (
			remoteSiteId: number,
			rewindId: string,
			path: string
		): Promise< TreeNode[] | null > => {
			if ( ! client ) {
				setError( new Error( 'No client available' ) );
				return null;
			}

			try {
				const requestBody: BackupLsRequest = {
					backup_id: rewindId,
					path,
				};

				const rawResponse = await client.req.post( {
					path: `/sites/${ remoteSiteId }/rewind/backup/ls`,
					apiNamespace: 'wpcom/v2',
					body: requestBody,
				} );

				// Validate just the body since that's what we get from the API client
				const validationResult = BackupLsResponseSchema.shape.body.safeParse( rawResponse );

				if ( ! validationResult.success ) {
					console.error( 'Invalid response format:', validationResult.error );
					throw new Error( 'Invalid response format from server' );
				}

				const response = validationResult.data;

				if ( ! response.ok ) {
					throw new Error( response.error || 'Failed to fetch remote file tree' );
				}

				const children: TreeNode[] = [];

				for ( const [ name, rawItem ] of Object.entries( response.contents ) ) {
					const itemValidation = BackupLsItemSchema.safeParse( rawItem );
					if ( itemValidation.success ) {
						const node = convertBackupItemToTreeNode( name, itemValidation.data, path );
						children.push( node );
					} else {
						console.warn( `Invalid item format for ${ name }:`, itemValidation.error );
					}
				}

				return children;
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
				setError( new Error( errorMessage ) );
				return null;
			}
		},
		[ client ]
	);

	const fetchChildren = useCallback(
		async (
			remoteSiteId: number,
			rewindId: string,
			path: string
		): Promise< TreeNode[] | null > => {
			setIsLoading( true );
			setError( null );

			try {
				return await fetchDirectoryContents( remoteSiteId, rewindId, path );
			} finally {
				setIsLoading( false );
			}
		},
		[ fetchDirectoryContents ]
	);

	return {
		isLoading,
		error,
		fetchChildren,
	};
}
