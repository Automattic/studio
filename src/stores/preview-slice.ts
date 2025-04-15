import crypto from 'crypto';
import { createSlice, createAsyncThunk, PayloadAction, createSelector } from '@reduxjs/toolkit';
import { CreateLoggerAction } from 'cli/commands/preview/logger-actions';
import { LIMIT_OF_ZIP_SITES_PER_USER } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState, store } from 'src/stores/index';

export type SnapshotOperation = {
	error: string | null;
	progress: number;
	siteId: string;
	status: 'pending' | 'fulfilled' | 'rejected';
	type: 'create' | 'update' | 'delete';
};

type PreviewState = {
	operations: Record< crypto.UUID, SnapshotOperation >;
	snapshotProgress: number;
	snapshots: Snapshot[];
	snapshotQuota: number;
};

const getInitialState = (): PreviewState => {
	return {
		operations: {},
		snapshotProgress: 0,
		snapshots: [],
		snapshotQuota: LIMIT_OF_ZIP_SITES_PER_USER,
	};
};

const getSnapshots = createAsyncThunk( 'preview/getSnapshots', async () => {
	return await getIpcApi().getSnapshots();
} );

const createSnapshot = createAsyncThunk(
	'preview/createSnapshot',
	async ( { siteId, siteFolder }: { siteId: string; siteFolder: string } ) => {
		const { operationId } = await getIpcApi().createSnapshot( siteFolder );
		return { operationId, siteId };
	}
);

const previewSlice = createSlice( {
	name: 'preview',
	initialState: getInitialState(),
	reducers: {
		updateOperation: (
			state,
			action: PayloadAction< { operationId: crypto.UUID; operation: Partial< SnapshotOperation > } >
		) => {
			Object.assign( state.operations[ action.payload.operationId ], action.payload.operation );
		},
		deleteOperation: ( state, action: PayloadAction< { operationId: crypto.UUID } > ) => {
			delete state.operations[ action.payload.operationId ];
		},
	},
	extraReducers: ( builder ) => {
		builder
			.addCase( getSnapshots.fulfilled, ( state, action ) => {
				state.snapshots = action.payload;
			} )
			.addCase( createSnapshot.fulfilled, ( state, action ) => {
				state.operations[ action.payload.operationId ] = {
					error: null,
					progress: 0,
					siteId: action.payload.siteId,
					status: 'pending',
					type: 'create',
				};
			} );
	},
	selectors: {
		selectSnapshots: ( state ) => state.snapshots,
		selectSnapshotsCount: ( state ) => state.snapshots.length,
		isOperationInProgressForSite: ( state, siteId: string ) =>
			Object.values( state.operations ).find( ( operation ) => operation.siteId === siteId ),
	},
} );

const selectSnapshotsBySiteAndUser = createSelector(
	[
		( state: RootState ) => state.preview.snapshots,
		( state: RootState, localSiteId: string ) => localSiteId,
		( state: RootState, localSiteId: string, userId: number ) => userId,
	],
	( snapshots = [], localSiteId, userId ) =>
		snapshots.filter(
			( snapshot ) => snapshot.localSiteId === localSiteId && snapshot.userId === userId
		)
);

function getProgress( action: CreateLoggerAction ) {
	switch ( action ) {
		case CreateLoggerAction.VALIDATE:
			return 5;
		case CreateLoggerAction.ARCHIVE:
			return 20;
		case CreateLoggerAction.UPLOAD:
			return 60;
		case CreateLoggerAction.READY:
			return 80;
		case CreateLoggerAction.APPDATA:
			return 100;
	}
}

function getOperation( operationId: crypto.UUID ) {
	const state = store.getState();
	return state.preview.operations[ operationId ];
}

window.ipcListener.subscribe( 'preview-output', ( event, payload ) => {
	const operation = getOperation( payload.operationId );
	if ( ! operation ) {
		return;
	}

	try {
		const progress = getProgress( payload.data.action );
		store.dispatch(
			previewActions.updateOperation( {
				operationId: payload.operationId,
				operation: { progress },
			} )
		);
	} catch ( error ) {
		console.error( 'Error parsing preview event:', error );
	}
} );

window.ipcListener.subscribe( 'preview-error', ( event, payload ) => {
	const operation = getOperation( payload.operationId );
	if ( ! operation ) {
		return;
	}

	try {
		store.dispatch(
			previewActions.updateOperation( {
				operationId: payload.operationId,
				operation: { status: 'rejected', error: payload.data.message },
			} )
		);
	} catch ( error ) {
		console.error( 'Error parsing preview error:', error );
	}
} );

window.ipcListener.subscribe( 'preview-success', ( event, data ) => {
	const operation = getOperation( data.operationId );
	if ( ! operation ) {
		return;
	}

	store.dispatch( previewActions.deleteOperation( { operationId: data.operationId } ) );
	store.dispatch( getSnapshots() );
} );

export const previewActions = previewSlice.actions;
export const previewSelectors = {
	...previewSlice.selectors,
	selectSnapshotsBySiteAndUser,
};
export const previewThunks = {
	getSnapshots,
	createSnapshot,
};
export const reducer = previewSlice.reducer;
