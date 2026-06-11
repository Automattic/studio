import { createSlice } from '@reduxjs/toolkit';
import { TreeNode } from 'src/components/tree-view';
import { userLoggedOut } from 'src/stores/auth-actions';
import { fetchRemoteFileTree } from './sync-api';

type RemoteFileTreeState = {
	loading: boolean;
	error: string | null;
	cache: Record< string, TreeNode[] >;
};

type SyncState = {
	remoteFileTrees: RemoteFileTreeState;
};

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
			.addCase( userLoggedOut, () => initialState )
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

export const syncReducer = syncSlice.reducer;

export const syncSelectors = {
	selectRemoteFileTree: ( state: { sync: SyncState }, key: string ) =>
		state.sync.remoteFileTrees.cache[ key ],
	selectIsLoadingFileTree: ( state: { sync: SyncState } ) => state.sync.remoteFileTrees.loading,
	selectFileTreeError: ( state: { sync: SyncState } ) => state.sync.remoteFileTrees.error,
};
