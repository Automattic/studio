import { createAsyncThunk } from '@reduxjs/toolkit';
import {
	backupLsItemSchema,
	backupLsResponseSchema,
	latestRewindIdResponseSchema,
} from '@studio/common/types/sync-tree';
import { TreeNode } from 'src/components/tree-view';
import { SYNC_OPTIONS } from 'src/constants';
import { wpcomApi } from 'src/stores/wpcom-api';
import type { BackupLsItem, BackupLsRequest } from '@studio/common/types/sync-tree';

const getParentFolder = ( parentPath: string ) => {
	return parentPath.split( '/' ).filter( Boolean ).pop() ?? '';
};

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

const syncApi = wpcomApi.injectEndpoints( {
	endpoints: ( builder ) => ( {
		getLatestRewindId: builder.query< string | null, number >( {
			query: ( remoteSiteId ) => ( {
				path: `/sites/${ remoteSiteId }/studio-app/sync/get-latest-rewind-id`,
				apiNamespace: 'wpcom/v2',
			} ),
			transformResponse: ( response: unknown ) => {
				const validationResult = latestRewindIdResponseSchema.safeParse( {
					body: response,
					status: 200,
				} );

				if ( ! validationResult.success ) {
					console.error( 'Invalid response format:', validationResult.error );
					throw new Error( 'Invalid response format from server' );
				}

				const responseData = validationResult.data.body;

				if ( responseData.success && responseData.rewind_id ) {
					return responseData.rewind_id;
				}

				throw new Error( 'Failed to fetch latest rewind ID' );
			},
			keepUnusedDataFor: 0, // Avoid caching the response
		} ),
	} ),
} );

export const fetchRemoteFileTree = createAsyncThunk(
	'sync/fetchRemoteFileTree',
	async ( {
		client,
		remoteSiteId,
		rewindId,
		path,
		parentChecked = false,
	}: {
		client: {
			req: {
				post: ( args: { path: string; apiNamespace: string; body: unknown } ) => Promise< unknown >;
			};
		};
		remoteSiteId: number;
		rewindId: string;
		path: string;
		parentChecked?: boolean;
	} ) => {
		const requestBody: BackupLsRequest = {
			backup_id: rewindId,
			path,
		};

		let rawResponse;
		try {
			rawResponse = await client.req.post( {
				path: `/sites/${ remoteSiteId }/rewind/backup/ls`,
				apiNamespace: 'wpcom/v2',
				body: requestBody,
			} );
		} catch ( err ) {
			const errorMessage =
				err instanceof Error ? err.message : 'Network error while fetching remote file tree';
			throw new Error( errorMessage );
		}

		const validationResult = backupLsResponseSchema.shape.body.safeParse( rawResponse );
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
			const itemValidation = backupLsItemSchema.safeParse( rawItem );
			if ( itemValidation.success ) {
				const node = convertBackupItemToTreeNode( name, itemValidation.data, path, parentChecked );
				children.push( node );
			} else {
				console.warn( `Invalid item format for ${ name }:`, itemValidation.error );
			}
		}

		return {
			key: `${ remoteSiteId }-${ rewindId }-${ path }`,
			children,
		};
	}
);

export const { useGetLatestRewindIdQuery } = syncApi;
