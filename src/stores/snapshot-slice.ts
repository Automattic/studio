import crypto from 'crypto';
import { createSlice, createAsyncThunk, PayloadAction, createSelector } from '@reduxjs/toolkit';
import { __ } from '@wordpress/i18n';
import { CreateLoggerAction } from 'cli/commands/preview/logger-actions';
import { LIMIT_OF_ZIP_SITES_PER_USER } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState, store } from 'src/stores/index';

export type SnapshotOperation = {
	detail: string;
	error: string | null;
	progress: number;
	siteId: string;
	status: 'pending' | 'fulfilled' | 'rejected';
	type: 'create' | 'update' | 'delete';
};

type SnapshotState = {
	operations: Record< crypto.UUID, SnapshotOperation >;
	snapshotProgress: number;
	snapshots: Snapshot[];
	snapshotQuota: number;
};

const getInitialState = (): SnapshotState => {
	return {
		operations: {},
		snapshotProgress: 0,
		snapshots: [],
		snapshotQuota: LIMIT_OF_ZIP_SITES_PER_USER,
	};
};

const getSnapshots = createAsyncThunk( 'snapshot/getSnapshots', async () => {
	return await getIpcApi().getSnapshots();
} );

const createSnapshot = createAsyncThunk(
	'snapshot/createSnapshot',
	async ( { siteId, siteFolder }: { siteId: string; siteFolder: string } ) => {
		const { operationId } = await getIpcApi().createSnapshot( siteFolder );
		return { operationId, siteId };
	}
);

const snapshotSlice = createSlice( {
	name: 'snapshot',
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
					detail: __( 'Creating archive...' ),
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
		( state: RootState ) => state.snapshot.snapshots,
		( state: RootState, localSiteId: string ) => localSiteId,
		( state: RootState, localSiteId: string, userId: number ) => userId,
	],
	( snapshots = [], localSiteId, userId ) =>
		snapshots.filter(
			( snapshot ) => snapshot.localSiteId === localSiteId && snapshot.userId === userId
		)
);

function getProgress( action: CreateLoggerAction ): [ string, number ] {
	switch ( action ) {
		case CreateLoggerAction.VALIDATE:
			return [ __( 'Creating archive...' ), 5 ];
		case CreateLoggerAction.ARCHIVE:
			return [ __( 'Creating archive...' ), 20 ];
		case CreateLoggerAction.UPLOAD:
			return [ __( 'Uploading archive...' ), 40 ];
		case CreateLoggerAction.READY:
			return [ __( 'Creating preview site...' ), 60 ];
		case CreateLoggerAction.APPDATA:
			return [ __( 'Saving preview site...' ), 95 ];
	}
}

function getOperation( operationId: crypto.UUID ) {
	const state = store.getState();
	return state.snapshot.operations[ operationId ];
}

window.ipcListener.subscribe( 'snapshot-output', ( event, payload ) => {
	const operation = getOperation( payload.operationId );
	if ( ! operation ) {
		return;
	}

	const [ detail, progress ] = getProgress( payload.data.action );
	store.dispatch(
		snapshotActions.updateOperation( {
			operationId: payload.operationId,
			operation: { detail, progress },
		} )
	);
} );

window.ipcListener.subscribe( 'snapshot-error', ( event, payload ) => {
	const operation = getOperation( payload.operationId );
	if ( ! operation ) {
		return;
	}

	store.dispatch(
		snapshotActions.updateOperation( {
			operationId: payload.operationId,
			operation: { status: 'rejected', error: payload.data.message },
		} )
	);
} );

window.ipcListener.subscribe( 'snapshot-success', ( event, data ) => {
	const operation = getOperation( data.operationId );
	if ( ! operation ) {
		return;
	}

	store.dispatch( snapshotActions.deleteOperation( { operationId: data.operationId } ) );
	store.dispatch( getSnapshots() );
} );

export const snapshotActions = snapshotSlice.actions;
export const snapshotSelectors = {
	...snapshotSlice.selectors,
	selectSnapshotsBySiteAndUser,
};
export const snapshotThunks = {
	getSnapshots,
	createSnapshot,
};
export const reducer = snapshotSlice.reducer;
