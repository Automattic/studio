import crypto from 'crypto';
import { createSlice, createAsyncThunk, PayloadAction, createSelector } from '@reduxjs/toolkit';
import { z } from 'zod';
import { CreateLoggerAction as LoggerAction } from 'cli/commands/preview/logger-actions';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState, store } from 'src/stores/index';

type SnapshotOperation = {
	error: string | null;
	progress: number;
	siteId: string;
	status: 'pending' | 'fulfilled' | 'rejected';
};

type PreviewState = {
	operations: Record< crypto.UUID, SnapshotOperation >;
	snapshotProgress: number;
	snapshots: Snapshot[];
};

const getInitialState = (): PreviewState => {
	return {
		operations: {},
		snapshotProgress: 0,
		snapshots: [],
	};
};

const getSnapshots = createAsyncThunk( 'preview/getSnapshots', async () => {
	console.log( 'getSnapshots' );
	return await getIpcApi().getSnapshots();
} );

type CreateSnapshotParams = {
	siteId: string;
	siteFolder: string;
};

const createSnapshot = createAsyncThunk(
	'preview/createSnapshot',
	async ( { siteId, siteFolder }: CreateSnapshotParams ) => {
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
				};
			} );
	},
	selectors: {
		selectSnapshots: ( state ) => state.snapshots,
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

function getProgress( action: LoggerAction ) {
	switch ( action ) {
		case LoggerAction.VALIDATE:
			return 5;
		case LoggerAction.ARCHIVE:
			return 20;
		case LoggerAction.UPLOAD:
			return 60;
		case LoggerAction.READY:
			return 80;
		case LoggerAction.APPDATA:
			return 100;
	}
}

const previewEventSchema = z.object( {
	action: z.nativeEnum( LoggerAction ),
	status: z.enum( [ 'inprogress', 'fail', 'success' ] ),
	message: z.string(),
} );

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
		const parsedData = previewEventSchema.parse( payload.data );
		const progress = getProgress( parsedData.action );
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
		const parsedData = previewEventSchema.parse( payload.data );
		store.dispatch(
			previewActions.updateOperation( {
				operationId: payload.operationId,
				operation: { status: 'rejected', error: parsedData.message },
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
