import {
	createAction,
	createAsyncThunk,
	createSelector,
	createSlice,
	PayloadAction,
} from '@reduxjs/toolkit';
import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { PreviewCommandLoggerAction } from '@studio/common/logger-actions';
import { Snapshot } from '@studio/common/types/snapshot';
import { __, sprintf } from '@wordpress/i18n';
import { LIMIT_OF_ZIP_SITES_PER_USER } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState, store } from 'src/stores/index';
import { wpcomApi } from 'src/stores/wpcom-api';
import type { UUID } from 'crypto';

type BaseOperation = {
	error: string | null;
	progress: number;
	snapshotName?: string;
	snapshotUrl?: string;
	status: 'pending' | 'fulfilled' | 'rejected';
};

type CreateOperation = BaseOperation & {
	type: 'create';
	detail: string;
	siteId: string;
};

type UpdateOperation = BaseOperation & {
	type: 'update';
	atomicSiteId: number;
};

type DeleteOperation = BaseOperation & {
	snapshotUrl: string;
	type: 'delete';
	optimistic?: boolean;
};

export type SnapshotOperation = CreateOperation | UpdateOperation | DeleteOperation;

type SnapshotState = {
	operations: Record< UUID, SnapshotOperation >;
	snapshots: Snapshot[];
	snapshotQuota: number;
};

const getInitialState = (): SnapshotState => {
	return {
		operations: {},
		snapshots: [],
		snapshotQuota: LIMIT_OF_ZIP_SITES_PER_USER,
	};
};

const createTypedAsyncThunk = createAsyncThunk.withTypes< {
	state: RootState;
} >();

const createSnapshot = createTypedAsyncThunk(
	'snapshot/createSnapshot',
	async ( { siteId, siteFolder }: { siteId: string; siteFolder: string } ) => {
		const { operationId } = await getIpcApi().createSnapshot( siteFolder );
		return { operationId, siteId };
	}
);

const updateSnapshot = createTypedAsyncThunk<
	{ operationId: UUID },
	{ atomicSiteId: number; siteFolder: string }
>( 'snapshot/updateSnapshot', async ( { atomicSiteId, siteFolder }, thunkAPI ) => {
	const state = thunkAPI.getState();
	const found = state.snapshot.snapshots.find( ( snap ) => snap.atomicSiteId === atomicSiteId );
	if ( ! found ) {
		throw new Error( 'Snapshot not found' );
	}
	const { operationId } = await getIpcApi().updateSnapshot( siteFolder, found.url );
	return { operationId };
} );

const deleteSnapshot = createTypedAsyncThunk(
	'snapshot/deleteSnapshot',
	async ( { hostname }: { hostname: string; optimistic?: boolean } ) => {
		const { operationId } = await getIpcApi().deleteSnapshot( hostname );
		return { operationId };
	}
);

const updateSnapshotLocally = createAction< {
	atomicSiteId: number;
	snapshot: Partial< Omit< Snapshot, 'atomicSiteId' > >;
} >( 'snapshot/updateSnapshot' );

const snapshotSlice = createSlice( {
	name: 'snapshot',
	initialState: getInitialState(),
	reducers: {
		deleteSnapshotLocally: ( state, action: PayloadAction< { atomicSiteId: number } > ) => {
			state.snapshots = state.snapshots.filter(
				( snapshot ) => snapshot.atomicSiteId !== action.payload.atomicSiteId
			);
		},
		deleteAllSnapshots: ( state ) => {
			state.snapshots = [];
		},
		addSnapshot: ( state, action: PayloadAction< { snapshot: Snapshot } > ) => {
			state.snapshots.push( action.payload.snapshot );
		},
		setSnapshots: ( state, action: PayloadAction< { snapshots: Snapshot[] } > ) => {
			state.snapshots = action.payload.snapshots;
		},
		updateOperation: (
			state,
			action: PayloadAction< { operationId: UUID; operation: Partial< SnapshotOperation > } >
		) => {
			Object.assign( state.operations[ action.payload.operationId ], action.payload.operation );
		},
	},
	extraReducers: ( builder ) => {
		builder
			.addCase( updateSnapshotLocally, ( state, action ) => {
				const snapshot = state.snapshots.find(
					( snapshot ) => snapshot.atomicSiteId === action.payload.atomicSiteId
				);
				if ( snapshot ) {
					Object.assign( snapshot, action.payload.snapshot );
				}
			} )
			.addCase( createSnapshot.fulfilled, ( state, action ) => {
				state.operations[ action.payload.operationId ] = {
					detail: __( 'Creating archive…' ),
					error: null,
					progress: 0,
					siteId: action.payload.siteId,
					status: 'pending',
					type: 'create',
				};
			} )
			.addCase( updateSnapshot.fulfilled, ( state, action ) => {
				state.operations[ action.payload.operationId ] = {
					atomicSiteId: action.meta.arg.atomicSiteId,
					error: null,
					progress: 0,
					status: 'pending',
					type: 'update',
				};
			} )
			.addCase( deleteSnapshot.fulfilled, ( state, action ) => {
				state.operations[ action.payload.operationId ] = {
					error: null,
					progress: 0,
					snapshotUrl: action.meta.arg.hostname,
					status: 'pending',
					type: 'delete',
					optimistic: action.meta.arg.optimistic ?? false,
				};
			} );
	},
	selectors: {
		selectActiveCreateOperationForSite: ( state, siteId: string ): CreateOperation | undefined =>
			Object.values( state.operations ).find(
				( operation ): operation is CreateOperation =>
					operation.status === 'pending' &&
					operation.type === 'create' &&
					operation.siteId === siteId
			),
		selectUpdateOperationForSnapshot: (
			state,
			atomicSiteId: number
		): UpdateOperation | undefined =>
			Object.values( state.operations ).find(
				( operation ): operation is UpdateOperation =>
					operation.type === 'update' && operation.atomicSiteId === atomicSiteId
			),
		selectDeleteOperationForSnapshot: ( state, snapshotUrl: string ): DeleteOperation | undefined =>
			Object.values( state.operations ).find(
				( operation ): operation is DeleteOperation =>
					operation.type === 'delete' && operation.snapshotUrl === snapshotUrl
			),
		selectIsAnySnapshotUpdating: ( state ) =>
			Object.values( state.operations ).some(
				( operation ) => operation.type === 'update' && operation.status === 'pending'
			),
	},
} );

// We use the `createSelector` API here to memoize the result. Whenever a selector returns a
// reference type (array, object, etc), it's good to use `createSelector` to avoid unnecessary
// React re-renders.
const selectActiveCreateUpdateOperationsForAnySite = createSelector(
	[ ( state: RootState ) => state.snapshot.operations ],
	( operations ) =>
		Object.values( operations ).filter(
			( operation ) =>
				( operation.type === 'update' || operation.type === 'create' ) &&
				operation.status === 'pending'
		)
);

const selectSnapshotsBySite = createSelector(
	[
		( state: RootState ) => state.snapshot.snapshots,
		( state: RootState, localSiteId: string ) => localSiteId,
	],
	( snapshots = [], localSiteId ) =>
		snapshots.filter( ( snapshot ) => snapshot.localSiteId === localSiteId )
);

const selectSnapshotsByUser = createSelector(
	[
		( state: RootState ) => state.snapshot.snapshots,
		( state: RootState, userId: number ) => userId,
	],
	( snapshots = [], userId ) => snapshots.filter( ( snapshot ) => snapshot.userId === userId )
);

const selectSnapshotsBySiteAndUser = createSelector(
	[
		( state: RootState ) => state.snapshot.snapshots,
		( state: RootState, localSiteId: string ) => localSiteId,
		( state: RootState, localSiteId: string, userId: number ) => userId,
		( state: RootState ) => state.snapshot.operations,
	],
	( snapshots = [], localSiteId, userId, operations ) =>
		snapshots
			.filter( ( snapshot ) => snapshot.localSiteId === localSiteId && snapshot.userId === userId )
			// Filter out any snapshots that are currently being deleted optimistically
			.filter(
				( snapshot ) =>
					! Object.values( operations ).some(
						( operation ) =>
							operation.snapshotUrl === snapshot.url &&
							operation.type === 'delete' &&
							operation.optimistic
					)
			)
);

// Optimistically update the snapshot usage count and schedule a re-fetch.
// There's a risk that more sites are deleted locally than the count returned by the
// API, because expired sites are preserved locally. Therefore, we need to ensure
// the count is non-negative.
function updateSnapshotUsageCount( countDiff: number, isAbsolute = false ) {
	if ( countDiff === 0 && ! isAbsolute ) {
		return;
	}

	store.dispatch(
		wpcomApi.util.updateQueryData( 'getSnapshotUsage', undefined, ( data ) => {
			if ( isAbsolute ) {
				data.siteCount = countDiff;
			} else {
				data.siteCount = Math.max( 0, data.siteCount + countDiff );
			}
		} )
	);

	// Wait for changes to take effect on the back-end before invalidating the query
	setTimeout( () => {
		store.dispatch( wpcomApi.util.invalidateTags( [ 'SnapshotUsage' ] ) );
	}, 8000 );
}

export async function refreshSnapshots() {
	const snapshots = await getIpcApi().fetchSnapshots();
	const state = store.getState();
	const countDiff = snapshots.length - state.snapshot.snapshots.length;

	store.dispatch( snapshotSlice.actions.setSnapshots( { snapshots } ) );
	updateSnapshotUsageCount( countDiff );
}

function getOperationProgress( action: PreviewCommandLoggerAction ): [ string, number ] {
	switch ( action ) {
		case PreviewCommandLoggerAction.VALIDATE:
			return [ __( 'Creating archive…' ), 5 ];
		case PreviewCommandLoggerAction.ARCHIVE:
			return [ __( 'Creating archive…' ), 20 ];
		case PreviewCommandLoggerAction.UPLOAD:
			return [ __( 'Uploading archive…' ), 40 ];
		case PreviewCommandLoggerAction.READY:
			return [ __( 'Creating preview site…' ), 60 ];
		case PreviewCommandLoggerAction.APPDATA:
			return [ __( 'Saving preview site…' ), 95 ];
		default:
			return [ '', 0 ];
	}
}

function getOperation( operationId: UUID ) {
	const state = store.getState();
	return state.snapshot.operations[ operationId ];
}

window.ipcListener.subscribe( 'snapshot-event', ( _, snapshotEvent ) => {
	const { event: eventType } = snapshotEvent;

	if ( eventType === SNAPSHOT_EVENTS.DELETED_ALL ) {
		store.dispatch( snapshotSlice.actions.deleteAllSnapshots() );
		updateSnapshotUsageCount( 0, true );
		return;
	}

	const { snapshot, snapshotUrl } = snapshotEvent;

	if ( eventType === SNAPSHOT_EVENTS.DELETED ) {
		const state = store.getState();
		const existing = state.snapshot.snapshots.find( ( s ) => s.url === snapshotUrl );
		if ( existing ) {
			store.dispatch(
				snapshotSlice.actions.deleteSnapshotLocally( { atomicSiteId: existing.atomicSiteId } )
			);
			updateSnapshotUsageCount( -1 );
		}
		return;
	}

	if ( ! snapshot ) {
		// Fallback to full refresh if no snapshot data included
		void refreshSnapshots();
		return;
	}

	if ( eventType === SNAPSHOT_EVENTS.CREATED ) {
		const state = store.getState();
		const existing = state.snapshot.snapshots.find( ( s ) => s.url === snapshot.url );
		if ( ! existing ) {
			store.dispatch( snapshotSlice.actions.addSnapshot( { snapshot } ) );
			updateSnapshotUsageCount( 1 );
		}
		return;
	}

	if ( eventType === SNAPSHOT_EVENTS.UPDATED ) {
		store.dispatch(
			snapshotActions.updateSnapshotLocally( {
				atomicSiteId: snapshot.atomicSiteId,
				snapshot,
			} )
		);
	}
} );

window.ipcListener.subscribe( 'snapshot-output', ( event, payload ) => {
	const operation = getOperation( payload.operationId );
	if ( ! operation ) {
		return;
	}

	const [ detail, progress ] = getOperationProgress( payload.data.action );
	store.dispatch(
		snapshotActions.updateOperation( {
			operationId: payload.operationId,
			operation: { detail, progress },
		} )
	);
} );

window.ipcListener.subscribe( 'snapshot-key-value', ( event, payload ) => {
	let operationUpdate: Partial< SnapshotOperation > = {};

	if ( payload.data.key === 'name' ) {
		operationUpdate = { snapshotName: payload.data.value };
	}
	if ( payload.data.key === 'url' ) {
		operationUpdate = { snapshotUrl: payload.data.value };
	}

	store.dispatch(
		snapshotActions.updateOperation( {
			operationId: payload.operationId,
			operation: operationUpdate,
		} )
	);
} );

function errorEventHandler( operationId: UUID, message: string ) {
	const operation = getOperation( operationId );
	if ( ! operation || operation.status !== 'pending' ) {
		return;
	}

	if ( operation.type === 'create' ) {
		getIpcApi().showErrorMessageBox( {
			title: __( 'Adding preview site failed' ),
			message: message,
		} );
	} else if ( operation.type === 'update' ) {
		getIpcApi().showErrorMessageBox( {
			title: __( 'Updating preview site failed' ),
			message: message,
		} );
	} else if ( operation.type === 'delete' ) {
		getIpcApi().showErrorMessageBox( {
			title: __( 'Deleting preview site failed' ),
			message: message,
		} );
	}

	store.dispatch(
		snapshotActions.updateOperation( {
			operationId: operationId,
			operation: { status: 'rejected', error: message },
		} )
	);
}

window.ipcListener.subscribe( 'snapshot-error', ( event, payload ) => {
	errorEventHandler( payload.operationId, payload.data.message );
} );

window.ipcListener.subscribe( 'snapshot-fatal-error', ( event, payload ) => {
	errorEventHandler( payload.operationId, payload.data.message );
} );

window.ipcListener.subscribe( 'snapshot-success', ( event, payload ) => {
	const operation = getOperation( payload.operationId );
	if ( ! operation ) {
		return;
	}

	store.dispatch(
		snapshotActions.updateOperation( {
			operationId: payload.operationId,
			operation: { status: 'fulfilled' },
		} )
	);

	const { snapshotUrl = '' } = operation;

	if ( operation.type === 'create' ) {
		getIpcApi().showNotification( {
			title: operation.snapshotName,
			body: sprintf( __( "Preview site '%s' has been created." ), snapshotUrl ),
		} );
	} else if ( operation.type === 'update' ) {
		getIpcApi().showNotification( {
			title: operation.snapshotName,
			body: sprintf( __( "Preview site '%s' has been updated." ), snapshotUrl ),
		} );
	} else if ( operation.type === 'delete' ) {
		if ( ! operation.optimistic ) {
			getIpcApi().showNotification( {
				title: operation.snapshotName,
				body: sprintf( __( "Preview site '%s' has been deleted." ), snapshotUrl ),
			} );
		}
	}
} );

export const snapshotActions = {
	...snapshotSlice.actions,
	updateSnapshotLocally,
};
export const snapshotSelectors = {
	...snapshotSlice.selectors,
	selectActiveCreateUpdateOperationsForAnySite,
	selectSnapshotsBySite,
	selectSnapshotsByUser,
	selectSnapshotsBySiteAndUser,
};
export const snapshotThunks = {
	createSnapshot,
	updateSnapshot,
	deleteSnapshot,
};
export const reducer = snapshotSlice.reducer;
