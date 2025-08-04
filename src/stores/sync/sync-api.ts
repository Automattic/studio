import { createAsyncThunk } from '@reduxjs/toolkit';
import { TreeNode } from 'src/components/tree-view';
import { SYNC_OPTIONS } from 'src/constants';
import { wpcomApi } from 'src/stores/wpcom-api';
import {
	BackupLsItemSchema,
	BackupLsRequest,
	BackupLsResponseSchema,
	LatestRewindIdResponseSchema,
	type BackupLsItem,
} from './sync-types';

// Helper functions for transforming data
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
	parentPath: string,
	parentChecked: boolean = false
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
		checked: parentChecked,
		type: isFolder ? 'folder' : 'file',
		pathId: item.id,
		path: fullPath,
		loading: false,
		children: isFolder ? [] : undefined,
		expanded: false,
	};
};

export const syncApi = wpcomApi.injectEndpoints( {
	endpoints: ( builder ) => ( {
		getLatestRewindId: builder.query< string | null, number >( {
			query: ( remoteSiteId ) => ( {
				path: `/sites/${ remoteSiteId }/studio-app/sync/get-latest-rewind-id`,
				apiNamespace: 'wpcom/v2',
			} ),
			transformResponse: ( response: unknown ) => {
				const validationResult = LatestRewindIdResponseSchema.safeParse( {
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
			keepUnusedDataFor: 60 * 5, // Cache for 5 minutes
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
