import {
	createAction,
	createAsyncThunk,
	createSelector,
	createSlice,
	isAnyOf,
	PayloadAction,
} from '@reduxjs/toolkit';
import { PreviewCommandLoggerAction } from '@studio/common/logger-actions';
import { Snapshot } from '@studio/common/types/snapshot';
import { __, sprintf } from '@wordpress/i18n';
import fastDeepEqual from 'fast-deep-equal';
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
};

type BulkOperation = Omit< BaseOperation, 'progress' > & {
	operationIds: UUID[];
	siteId?: string;
	type: 'bulk';
	userId?: number;
};

export type SnapshotOperation = CreateOperation | UpdateOperation | DeleteOperation | BulkOperation;

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

const createSnapshot = createAsyncThunk(
	'snapshot/createSnapshot',
	async ( { siteId, siteFolder }: { siteId: string; siteFolder: string } ) => {
		const { operationId } = await getIpcApi().createSnapshot( siteFolder );
		return { operationId, siteId };
	}
);

const updateSnapshot = createAsyncThunk(
	'snapshot/updateSnapshot',
	async (
		{ atomicSiteId, siteFolder }: { atomicSiteId: number; siteFolder: string },
		thunkAPI
	) => {
		const state = thunkAPI.getState() as RootState;
		const found = state.snapshot.snapshots.find( ( snap ) => snap.atomicSiteId === atomicSiteId );
		if ( ! found ) {
			throw new Error( 'Snapshot not found' );
		}
		const { operationId } = await getIpcApi().updateSnapshot( siteFolder, found.url );
		return { operationId };
	}
);

const deleteSnapshot = createAsyncThunk(
	'snapshot/deleteSnapshot',
	async ( { hostname }: { hostname: string } ) => {
		const { operationId } = await getIpcApi().deleteSnapshot( hostname );
		return { operationId };
	}
);

async function deleteMultipleSnapshots(
	snapshots: Snapshot[]
): Promise< [ url: string, operationId: UUID ][] > {
	return await Promise.all(
		snapshots.map( async ( snapshot ) => {
			const { operationId } = await getIpcApi().deleteSnapshot( snapshot.url );
			return [ snapshot.url, operationId ];
		} )
	);
}

const deleteAllSnapshotsForSite = createAsyncThunk(
	'snapshot/deleteAllSnapshotsForSite',
	async ( { siteId }: { siteId: string }, thunkAPI ) => {
		const state = thunkAPI.getState() as RootState;
		const snapshots = snapshotSelectors.selectSnapshotsBySite( state, siteId );
		const operations = await deleteMultipleSnapshots( snapshots );
		const bulkOperationId = window.crypto.randomUUID();

		return { operations, bulkOperationId };
	}
);

const deleteAllSnapshotsForUser = createAsyncThunk(
	'snapshot/deleteAllSnapshotsForUser',
	async ( { userId }: { userId: number }, thunkAPI ) => {
		const state = thunkAPI.getState() as RootState;
		const snapshots = snapshotSelectors.selectSnapshotsByUser( state, userId );
		const operations = await deleteMultipleSnapshots( snapshots );
		const bulkOperationId = window.crypto.randomUUID();

		return { operations, bulkOperationId };
	}
);

export const updateSnapshotLocally = createAction< {
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
				};
			} )
			.addMatcher(
				isAnyOf( deleteAllSnapshotsForSite.fulfilled, deleteAllSnapshotsForUser.fulfilled ),
				( state, action ) => {
					if ( ! action.payload.operations.length ) {
						return;
					}

					const bulkOperation: BulkOperation = {
						error: null,
						operationIds: action.payload.operations.map( ( [ _, operationId ] ) => operationId ),
						status: 'pending',
						type: 'bulk',
					};

					if ( 'siteId' in action.meta.arg ) {
						bulkOperation.siteId = action.meta.arg.siteId;
					} else if ( 'userId' in action.meta.arg ) {
						bulkOperation.userId = action.meta.arg.userId;
					}

					state.operations[ action.payload.bulkOperationId ] = bulkOperation;

					action.payload.operations.forEach( ( [ url, operationId ] ) => {
						state.operations[ operationId ] = {
							error: null,
							progress: 0,
							snapshotUrl: url,
							status: 'pending',
							type: 'delete',
						};
					} );
				}
			);
	},
	selectors: {
		selectActiveBulkOperationForUser: ( state, userId: number ): BulkOperation | undefined =>
			Object.values( state.operations ).find(
				( operation ): operation is BulkOperation =>
					operation.status === 'pending' && operation.type === 'bulk' && operation.userId === userId
			),
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

const selectActiveOperationsForAnySite = createSelector(
	[ ( state: RootState ) => state.snapshot.operations ],
	( operations ) =>
		Object.values( operations ).filter( ( operation ) => operation.status === 'pending' )
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
	],
	( snapshots = [], localSiteId, userId ) =>
		snapshots.filter(
			( snapshot ) => snapshot.localSiteId === localSiteId && snapshot.userId === userId
		)
);

window.ipcListener.subscribe( 'user-data-updated', ( _, payload ) => {
	const state = store.getState();
	const snapshots = payload.snapshots;

	if ( ! fastDeepEqual( state.snapshot.snapshots, snapshots ) ) {
		store.dispatch( snapshotSlice.actions.setSnapshots( { snapshots } ) );

		// Optimistically update the snapshot usage count
		const countDiff = snapshots.length - state.snapshot.snapshots.length;
		store.dispatch(
			wpcomApi.util.updateQueryData( 'getSnapshotUsage', undefined, ( data ) => {
				// There's a risk that more sites are deleted locally than the count returned by the
				// API, because expired sites are preserved locally. Therefore, we need to ensure
				// the count is non-negative.
				data.siteCount = Math.max( 0, data.siteCount + countDiff );
			} )
		);

		// Wait for changes to take effect on the back-end before invalidating the query
		setTimeout( () => {
			store.dispatch( wpcomApi.util.invalidateTags( [ 'SnapshotUsage' ] ) );
		}, 8000 );
	}
} );

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

function getAssociatedBulkOperation( targetOperationId: UUID ): [ UUID, BulkOperation ] | [] {
	const state = store.getState();
	const entries = Object.entries( state.snapshot.operations ) as [ UUID, SnapshotOperation ][];

	for ( const [ operationId, operation ] of entries ) {
		if ( operation.type === 'bulk' && operation.operationIds.includes( targetOperationId ) ) {
			return [ operationId, operation ];
		}
	}

	return [];
}

function isBulkOperationSettled( bulkOperation: BulkOperation ) {
	return bulkOperation.operationIds.every( ( operationId ) => {
		const operation = getOperation( operationId );
		return operation && operation.status !== 'pending';
	} );
}

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

	const [ bulkOperationId, bulkOperation ] = getAssociatedBulkOperation( payload.operationId );
	const bulkOperationIsSettled = bulkOperation && isBulkOperationSettled( bulkOperation );

	if ( bulkOperationId && bulkOperationIsSettled ) {
		store.dispatch(
			snapshotActions.updateOperation( {
				operationId: bulkOperationId,
				operation: { status: 'fulfilled' },
			} )
		);
	}

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
		if ( ! bulkOperation ) {
			getIpcApi().showNotification( {
				title: operation.snapshotName,
				body: sprintf( __( "Preview site '%s' has been deleted." ), snapshotUrl ),
			} );
		} else if ( bulkOperationIsSettled ) {
			getIpcApi().showNotification( {
				title: __( 'Delete Successful' ),
				body: __( 'All preview sites have been deleted.' ),
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
	selectActiveOperationsForAnySite,
	selectSnapshotsBySite,
	selectSnapshotsByUser,
	selectSnapshotsBySiteAndUser,
};
export const snapshotThunks = {
	createSnapshot,
	updateSnapshot,
	deleteSnapshot,
	deleteAllSnapshotsForSite,
	deleteAllSnapshotsForUser,
};
export const reducer = snapshotSlice.reducer;
