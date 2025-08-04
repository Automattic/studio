import { createSlice } from '@reduxjs/toolkit';
import { useCallback } from 'react';
import { TreeNode } from 'src/components/tree-view';
import { useAuth } from 'src/hooks/use-auth';
import { useAppDispatch, useRootSelector, RootState } from 'src/stores';
import { fetchRemoteFileTree } from './sync-api';

interface RemoteFileTreeState {
	loading: boolean;
	error: string | null;
	// key: `${siteId}-${rewindId}-${path}`
	cache: Record< string, TreeNode[] >;
}

interface SyncState {
	remoteFileTrees: RemoteFileTreeState;
}

const initialState: SyncState = {
	remoteFileTrees: {
		loading: false,
		error: null,
		cache: {},
	},
};

const syncSlice = createSlice( {
	name: 'sync',
	initialState,
	reducers: {
		clearFileTreeError: ( state ) => {
			state.remoteFileTrees.error = null;
		},
		clearFileTreeCache: ( state ) => {
			state.remoteFileTrees.cache = {};
		},
	},
	extraReducers: ( builder ) => {
		builder
			// Handle fetchRemoteFileTree
			.addCase( fetchRemoteFileTree.pending, ( state ) => {
				state.remoteFileTrees.loading = true;
				state.remoteFileTrees.error = null;
			} )
			.addCase( fetchRemoteFileTree.fulfilled, ( state, action ) => {
				state.remoteFileTrees.loading = false;
				state.remoteFileTrees.cache[ action.payload.key ] = action.payload.children;
			} )
			.addCase( fetchRemoteFileTree.rejected, ( state, action ) => {
				state.remoteFileTrees.loading = false;
				state.remoteFileTrees.error = action.error.message || 'Failed to fetch remote file tree';
			} );
	},
} );

export const syncActions = syncSlice.actions;
export const syncReducer = syncSlice.reducer;

export const syncSelectors = {
	selectRemoteFileTree: ( state: RootState, key: string ) =>
		state.sync.remoteFileTrees.cache[ key ],
	selectIsLoadingFileTree: ( state: RootState ) => state.sync.remoteFileTrees.loading,
	selectFileTreeError: ( state: RootState ) => state.sync.remoteFileTrees.error,
};

export function useLatestRewindId( remoteSiteId: number | undefined ) {
	const { useGetLatestRewindIdQuery } = require( './sync-api' );

	const {
		data: rewindId,
		isLoading,
		error,
	} = useGetLatestRewindIdQuery( remoteSiteId || 0, {
		skip: ! remoteSiteId,
	} );

	return {
		rewindId: rewindId || null,
		isLoading,
		error: error ? new Error( error as unknown as string ) : null,
	};
}

export function useRemoteFileTree() {
	const dispatch = useAppDispatch();
	const { client } = useAuth();
	const isLoading = useRootSelector( syncSelectors.selectIsLoadingFileTree );
	const error = useRootSelector( syncSelectors.selectFileTreeError );

	const fetchChildren = useCallback(
		async (
			remoteSiteId: number,
			rewindId: string,
			path: string,
			parentChecked: boolean = false
		): Promise< TreeNode[] | null > => {
			if ( ! client ) {
				return null;
			}

			try {
				const result = await dispatch(
					fetchRemoteFileTree( {
						client,
						remoteSiteId,
						rewindId,
						path,
						parentChecked,
					} )
				).unwrap();

				return result.children;
			} catch ( err ) {
				console.error( 'Failed to fetch remote file tree:', err );
				return null;
			}
		},
		[ client, dispatch ]
	);

	return {
		isLoading,
		error: error ? new Error( error ) : null,
		fetchChildren,
	};
}
