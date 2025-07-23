import { useCallback, useState } from 'react';
import { TreeNode } from 'src/components/tree-view';
import { SYNC_OPTIONS } from 'src/constants';
import { useAuth } from 'src/hooks/use-auth';
import { BackupLsItemSchema, BackupLsResponseSchema } from './types';
import type { BackupLsItem, BackupLsRequest } from './types';

interface UseRemoteFileTreeResult {
	isLoading: boolean;
	error: Error | null;
	fetchRemoteFileTree: (
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
	_path: string
): TreeNode => {
	const nodeId = mapItemTypeToSyncOption( name );

	return {
		id: nodeId,
		name,
		label: name,
		checked: true,
		type: item.type === 'dir' ? 'folder' : 'file',
		pathId: item.id,
		loading: false,
		children: item.has_children ? [] : undefined,
		totalItems: item.total_items,
	};
};

export function useRemoteFileTree(): UseRemoteFileTreeResult {
	const { client } = useAuth();
	const [ isLoading, setIsLoading ] = useState( false );
	const [ error, setError ] = useState< Error | null >( null );

	const fetchRemoteFileTree = useCallback(
		async (
			remoteSiteId: number,
			rewindId: string,
			path: string = '/wp-content/'
		): Promise< TreeNode[] | null > => {
			if ( ! client ) {
				setError( new Error( 'No client available' ) );
				return null;
			}

			setIsLoading( true );
			setError( null );

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

				const validationResult = BackupLsResponseSchema.safeParse( {
					body: rawResponse,
					status: 200,
					headers: { Allow: 'POST' },
				} );

				if ( ! validationResult.success ) {
					console.error( 'Invalid response format:', validationResult.error );
					throw new Error( 'Invalid response format from server' );
				}

				const response = validationResult.data.body;

				if ( ! response.ok ) {
					throw new Error( response.error || 'Failed to fetch remote file tree' );
				}

				const treeNodes: TreeNode[] = [];
				const wpContentChildren: TreeNode[] = [];

				for ( const [ name, rawItem ] of Object.entries( response.contents ) ) {
					const itemValidation = BackupLsItemSchema.safeParse( rawItem );
					if ( itemValidation.success ) {
						const node = convertBackupItemToTreeNode( name, itemValidation.data, path );
						wpContentChildren.push( node );
					} else {
						console.warn( `Invalid item format for ${ name }:`, itemValidation.error );
					}
				}

				const filesAndFoldersNode: TreeNode = {
					id: 'filesAndFolders',
					name: 'filesAndFolders',
					label: 'Files and folders',
					checked: true,
					type: 'folder',
					expanded: false,
					children: [
						{
							id: 'wp-content',
							name: 'wp-content',
							label: 'wp-content',
							checked: true,
							type: 'folder',
							expanded: true,
							children: wpContentChildren,
						},
					],
				};

				const databaseNode: TreeNode = {
					id: SYNC_OPTIONS.sqls,
					name: SYNC_OPTIONS.sqls,
					label: 'Database',
					checked: true,
					type: 'file',
				};

				treeNodes.push( filesAndFoldersNode );
				treeNodes.push( databaseNode );

				return treeNodes;
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
				setError( new Error( errorMessage ) );
				return null;
			} finally {
				setIsLoading( false );
			}
		},
		[ client ]
	);

	return {
		isLoading,
		error,
		fetchRemoteFileTree,
	};
}
