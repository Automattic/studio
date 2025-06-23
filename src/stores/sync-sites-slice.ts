import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
	sitesEndpointResponseSchema,
	transformSitesResponse,
} from 'src/hooks/use-fetch-wpcom-sites/index';
import { reconcileConnectedSites } from 'src/hooks/use-fetch-wpcom-sites/reconcile-connected-sites';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { RootState } from './index';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';
import type { BackupArchiveInfo } from 'src/lib/import-export/import/types';

interface PullState {
	status: {
		key: 'in-progress' | 'downloading' | 'importing' | 'finished' | 'failed' | 'cancelled';
		message: string;
		progress: number;
	};
}

interface PushState {
	status: {
		key:
			| 'creatingBackup'
			| 'uploading'
			| 'creatingRemoteBackup'
			| 'applyingChanges'
			| 'finishing'
			| 'finished'
			| 'failed';
		message: string;
		progress: number;
	};
}

type IsSyncSitesSelectorOpen = boolean | { disconnectSiteId?: number };

interface SyncSitesError {
	message: string;
	code?: string | number;
}

interface SyncSitesState {
	pullStates: Record< string, Record< number, PullState > >;
	pushStates: Record< string, Record< number, PushState > >;
	connectedSites: SyncSite[];
	isSyncSitesSelectorOpen: IsSyncSitesSelectorOpen;
	isFetching: boolean;
	syncSites: SyncSite[];
	error?: SyncSitesError | null;
}

const initialState: SyncSitesState = {
	pullStates: {},
	pushStates: {},
	connectedSites: [],
	isSyncSitesSelectorOpen: false,
	isFetching: false,
	syncSites: [],
	error: null,
};

interface WpcomRestClient {
	req: {
		get: (
			path: { apiNamespace: string; path: string },
			params?: Record< string, unknown >
		) => Promise< unknown >;
	};
}

export const loadConnectedSites = createAsyncThunk(
	'syncSites/loadConnectedSites',
	async ( localSiteId: string, { rejectWithValue } ) => {
		try {
			const sites = await getIpcApi().getConnectedWpcomSites( localSiteId );
			return sites as SyncSite[];
		} catch ( error ) {
			return rejectWithValue( error );
		}
	}
);

export const refetchSites = createAsyncThunk(
	'syncSites/refetchSites',
	async ( { client }: { client: WpcomRestClient }, { rejectWithValue } ) => {
		try {
			const allConnectedSites = await getIpcApi().getConnectedWpcomSites();
			const fields = [
				'name',
				'ID',
				'URL',
				'plan',
				'capabilities',
				'is_wpcom_atomic',
				'options',
				'jetpack',
				'is_deleted',
				'is_a8c',
				'hosting_provider_guess',
				'environment_type',
			].join( ',' );

			const response = await client.req.get(
				{
					apiNamespace: 'rest/v1.2',
					path: `/me/sites`,
				},
				{
					fields,
					filter: 'atomic,wpcom',
					options: 'created_at,wpcom_staging_blog_ids',
					site_activity: 'active',
				}
			);

			const parsedResponse = sitesEndpointResponseSchema.parse( response );
			const syncSites = transformSitesResponse(
				parsedResponse.sites,
				( allConnectedSites as SyncSite[] ).map( ( site: SyncSite ) => site.id )
			);

			const { updatedConnectedSites, stagingSitesToAdd, stagingSitesToDelete } =
				reconcileConnectedSites( allConnectedSites as SyncSite[], syncSites );

			await getIpcApi().updateConnectedWpcomSites( updatedConnectedSites );

			if ( stagingSitesToDelete.length ) {
				const data = stagingSitesToDelete.map( ( { id, localSiteId } ) => ( {
					siteIds: [ id ],
					localSiteId,
				} ) );
				await getIpcApi().disconnectWpcomSites( data );
			}

			if ( stagingSitesToAdd.length ) {
				const data = stagingSitesToAdd.map( ( site ) => ( {
					sites: [ site ],
					localSiteId: site.localSiteId,
				} ) );
				await getIpcApi().connectWpcomSites( data );
			}

			return syncSites;
		} catch ( error ) {
			console.error( error );
			return rejectWithValue( error );
		}
	}
);

export const connectSite = createAsyncThunk(
	'syncSites/connectSite',
	async (
		{ sites, localSiteId }: { sites: SyncSite[]; localSiteId: string },
		{ rejectWithValue }
	) => {
		try {
			await getIpcApi().connectWpcomSites( [ { sites, localSiteId } ] );
			const updatedSites = await getIpcApi().getConnectedWpcomSites( localSiteId );
			return updatedSites as SyncSite[];
		} catch ( error ) {
			return rejectWithValue( error );
		}
	}
);

export const disconnectSite = createAsyncThunk(
	'syncSites/disconnectSite',
	async (
		{ siteIds, localSiteId }: { siteIds: number[]; localSiteId: string },
		{ rejectWithValue }
	) => {
		try {
			await getIpcApi().disconnectWpcomSites( [ { siteIds, localSiteId } ] );
			const updatedSites = await getIpcApi().getConnectedWpcomSites( localSiteId );
			return updatedSites as SyncSite[];
		} catch ( error ) {
			return rejectWithValue( error );
		}
	}
);

export const pullSite = createAsyncThunk(
	'syncSites/pullSite',
	async (
		{
			remoteSiteId,
			localSiteId,
			downloadUrl,
		}: { remoteSiteId: number; localSiteId: string; downloadUrl: string },
		{ rejectWithValue }
	) => {
		try {
			const backupFilePath = await getIpcApi().downloadSyncBackup( remoteSiteId, downloadUrl );
			const backupFile: BackupArchiveInfo = { path: backupFilePath, type: 'tar.gz' };
			const result = await getIpcApi().importSite( { id: localSiteId, backupFile } );
			await getIpcApi().removeSyncBackup( remoteSiteId );
			return result;
		} catch ( error ) {
			return rejectWithValue( error );
		}
	}
);

export const pushSite = createAsyncThunk(
	'syncSites/pushSite',
	async (
		{ localSiteId, remoteSiteId }: { localSiteId: string; remoteSiteId: number },
		{ rejectWithValue }
	) => {
		try {
			const archiveInfo = await getIpcApi().exportSiteToPush( localSiteId );
			return archiveInfo;
		} catch ( error ) {
			return rejectWithValue( error );
		}
	}
);

export const updateSiteTimestamp = createAsyncThunk(
	'syncSites/updateSiteTimestamp',
	async (
		{ updatedSite, localSiteId }: { updatedSite: SyncSite; localSiteId: string },
		{ rejectWithValue }
	) => {
		try {
			await getIpcApi().updateSingleConnectedWpcomSite( updatedSite );
			const updatedSites = await getIpcApi().getConnectedWpcomSites( localSiteId );
			return updatedSites as SyncSite[];
		} catch ( error ) {
			return rejectWithValue( error );
		}
	}
);

const syncSitesSlice = createSlice( {
	name: 'syncSites',
	initialState,
	reducers: {
		setIsSyncSitesSelectorOpen: (
			state,
			action: PayloadAction< boolean | { disconnectSiteId?: number } >
		) => {
			state.isSyncSitesSelectorOpen = action.payload;
		},
		clearPullState: (
			state,
			action: PayloadAction< { localSiteId: string; connectedSiteId: number } >
		) => {
			const { localSiteId, connectedSiteId } = action.payload;
			if ( state.pullStates[ localSiteId ] ) {
				delete state.pullStates[ localSiteId ][ connectedSiteId ];
				if ( Object.keys( state.pullStates[ localSiteId ] ).length === 0 ) {
					delete state.pullStates[ localSiteId ];
				}
			}
		},
		clearPushState: (
			state,
			action: PayloadAction< { localSiteId: string; connectedSiteId: number } >
		) => {
			const { localSiteId, connectedSiteId } = action.payload;
			if ( state.pushStates[ localSiteId ] ) {
				delete state.pushStates[ localSiteId ][ connectedSiteId ];
				if ( Object.keys( state.pushStates[ localSiteId ] ).length === 0 ) {
					delete state.pushStates[ localSiteId ];
				}
			}
		},
	},
	extraReducers: ( builder ) => {
		builder
			.addCase( loadConnectedSites.pending, ( state ) => {
				state.isFetching = true;
				state.error = null;
			} )
			.addCase( loadConnectedSites.fulfilled, ( state, action ) => {
				state.isFetching = false;
				state.connectedSites = action.payload;
			} )
			.addCase( loadConnectedSites.rejected, ( state, action ) => {
				state.isFetching = false;
				state.error = {
					message: String( action.error.message || 'Failed to load connected sites' ),
					code: action.error.code,
				};
			} )
			.addCase( refetchSites.pending, ( state ) => {
				state.isFetching = true;
				state.error = null;
			} )
			.addCase( refetchSites.fulfilled, ( state, action ) => {
				state.isFetching = false;
				state.syncSites = action.payload;
			} )
			.addCase( refetchSites.rejected, ( state, action ) => {
				state.isFetching = false;
				state.error = {
					message: String( action.error.message || 'Failed to refetch sites' ),
					code: action.error.code,
				};
			} )
			.addCase( connectSite.pending, ( state ) => {
				state.isFetching = true;
				state.error = null;
			} )
			.addCase( connectSite.fulfilled, ( state, action ) => {
				state.isFetching = false;
				state.connectedSites = action.payload;
			} )
			.addCase( connectSite.rejected, ( state, action ) => {
				state.isFetching = false;
				state.error = {
					message: String( action.error.message || 'Failed to connect site' ),
					code: action.error.code,
				};
			} )
			.addCase( disconnectSite.pending, ( state ) => {
				state.isFetching = true;
				state.error = null;
			} )
			.addCase( disconnectSite.fulfilled, ( state, action ) => {
				state.isFetching = false;
				state.connectedSites = action.payload;
			} )
			.addCase( disconnectSite.rejected, ( state, action ) => {
				state.isFetching = false;
				state.error = {
					message: String( action.error.message || 'Failed to disconnect site' ),
					code: action.error.code,
				};
			} )
			.addCase( updateSiteTimestamp.pending, ( state ) => {
				state.isFetching = true;
				state.error = null;
			} )
			.addCase( updateSiteTimestamp.fulfilled, ( state, action ) => {
				state.isFetching = false;
				state.connectedSites = action.payload;
			} )
			.addCase( updateSiteTimestamp.rejected, ( state, action ) => {
				state.isFetching = false;
				state.error = {
					message: String( action.error.message || 'Failed to update site timestamp' ),
					code: action.error.code,
				};
			} )
			.addCase( pullSite.pending, ( state, action ) => {
				state.isFetching = true;
				state.error = null;
				const { remoteSiteId, localSiteId } = action.meta.arg;
				state.pullStates[ localSiteId ] = {
					...state.pullStates[ localSiteId ],
					[ remoteSiteId ]: {
						status: { key: 'in-progress', message: 'Initializing backup...', progress: 30 },
					},
				};
			} )
			.addCase( pullSite.fulfilled, ( state, action ) => {
				state.isFetching = false;
				const { remoteSiteId, localSiteId } = action.meta.arg;
				delete state.pullStates[ localSiteId ][ remoteSiteId ];
				if ( Object.keys( state.pullStates[ localSiteId ] ).length === 0 ) {
					delete state.pullStates[ localSiteId ];
				}
			} )
			.addCase( pullSite.rejected, ( state, action ) => {
				state.isFetching = false;
				state.error = {
					message: String( action.error.message || 'Failed to pull site' ),
					code: action.error.code,
				};
				const { remoteSiteId, localSiteId } = action.meta.arg;
				delete state.pullStates[ localSiteId ][ remoteSiteId ];
				if ( Object.keys( state.pullStates[ localSiteId ] ).length === 0 ) {
					delete state.pullStates[ localSiteId ];
				}
			} )
			.addCase( pushSite.pending, ( state, action ) => {
				state.isFetching = true;
				state.error = null;
				const { localSiteId, remoteSiteId } = action.meta.arg;
				state.pushStates[ localSiteId ] = {
					...state.pushStates[ localSiteId ],
					[ remoteSiteId ]: {
						status: { key: 'creatingBackup', message: 'Creating backup...', progress: 20 },
					},
				};
			} )
			.addCase( pushSite.fulfilled, ( state, action ) => {
				state.isFetching = false;
				const { localSiteId, remoteSiteId } = action.meta.arg;
				delete state.pushStates[ localSiteId ][ remoteSiteId ];
				if ( Object.keys( state.pushStates[ localSiteId ] ).length === 0 ) {
					delete state.pushStates[ localSiteId ];
				}
			} )
			.addCase( pushSite.rejected, ( state, action ) => {
				state.isFetching = false;
				state.error = {
					message: String( action.error.message || 'Failed to push site' ),
					code: action.error.code,
				};
				const { localSiteId, remoteSiteId } = action.meta.arg;
				delete state.pushStates[ localSiteId ][ remoteSiteId ];
				if ( Object.keys( state.pushStates[ localSiteId ] ).length === 0 ) {
					delete state.pushStates[ localSiteId ];
				}
			} );
	},
} );

export const syncSitesActions = {
	...syncSitesSlice.actions,
	loadConnectedSites,
	connectSite,
	disconnectSite,
	updateSiteTimestamp,
	refetchSites,
	pullSite,
	pushSite,
};

export const { reducer: syncSitesReducer } = syncSitesSlice;

export const selectIsFetching = ( state: RootState ) => state.syncSites.isFetching;
export const selectError = ( state: RootState ) => state.syncSites.error;
export const selectConnectedSites = ( state: RootState ) => state.syncSites.connectedSites;
export const selectSyncSites = ( state: RootState ) => state.syncSites.syncSites;
export const selectIsSyncSitesSelectorOpen = ( state: RootState ) =>
	state.syncSites.isSyncSitesSelectorOpen;
export const selectPullStates = ( state: RootState ) => state.syncSites.pullStates;
export const selectPushStates = ( state: RootState ) => state.syncSites.pushStates;

export const selectIsAnySitePulling = ( state: RootState ) => {
	const pullStates = selectPullStates( state );
	const pullingKeys = [ 'in-progress', 'downloading', 'importing' ];
	return Object.values( pullStates ).some( ( siteStates ) =>
		Object.values( siteStates ).some(
			( pullState ) => pullState?.status?.key && pullingKeys.includes( pullState.status.key )
		)
	);
};

export const selectIsAnySitePushing = ( state: RootState ) => {
	const pushStates = selectPushStates( state );
	const pushingKeys = [
		'creatingBackup',
		'uploading',
		'creatingRemoteBackup',
		'applyingChanges',
		'finishing',
	];
	return Object.values( pushStates ).some( ( siteStates ) =>
		Object.values( siteStates ).some(
			( pushState ) => pushState?.status?.key && pushingKeys.includes( pushState.status.key )
		)
	);
};

export const selectPullState =
	( localSiteId: string, connectedSiteId: number ) => ( state: RootState ) => {
		return state.syncSites.pullStates[ localSiteId ]?.[ connectedSiteId ];
	};

export const selectPushState =
	( localSiteId: string, connectedSiteId: number ) => ( state: RootState ) => {
		return state.syncSites.pushStates[ localSiteId ]?.[ connectedSiteId ];
	};

export const selectIsSiteIdPulling =
	( localSiteId: string, connectedSiteId: number ) => ( state: RootState ) => {
		const pullState = selectPullState( localSiteId, connectedSiteId )( state );
		return Boolean( pullState?.status?.key?.includes( 'pulling' ) );
	};

export const selectIsSiteIdPushing =
	( localSiteId: string, connectedSiteId: number ) => ( state: RootState ) => {
		const pushState = selectPushState( localSiteId, connectedSiteId )( state );
		return Boolean( pushState?.status?.key?.includes( 'pushing' ) );
	};
