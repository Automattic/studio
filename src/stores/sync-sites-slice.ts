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

// Types for pull/push state (to be expanded as needed)
type PullState = object;
type PushState = object;

type IsSyncSitesSelectorOpen = boolean | { disconnectSiteId?: number };

interface SyncSitesError {
	message: string;
	code?: string | number;
}

interface SyncSitesState {
	pullStates: Record< string, PullState >;
	pushStates: Record< string, PushState >;
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

// Add a minimal type for the REST client
interface WpcomRestClient {
	req: {
		get: (
			path: { apiNamespace: string; path: string },
			params?: Record< string, unknown >
		) => Promise< unknown >;
	};
}

// Async thunks (placeholder logic)
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
			// Optionally: Sentry.captureException(error);
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
			// Return the updated list of connected sites
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
			// Return the updated list of connected sites
			const updatedSites = await getIpcApi().getConnectedWpcomSites( localSiteId );
			return updatedSites as SyncSite[];
		} catch ( error ) {
			return rejectWithValue( error );
		}
	}
);

/**
 * Pulls a remote site backup and imports it into a local site.
 * @param remoteSiteId - The remote site ID (number)
 * @param localSiteId - The local site ID (string)
 * @param downloadUrl - The URL to download the backup from (string)
 */
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
			// 1. Download backup from remote
			const backupFilePath = await getIpcApi().downloadSyncBackup( remoteSiteId, downloadUrl );
			// 2. Construct BackupArchiveInfo
			const backupFile: BackupArchiveInfo = { path: backupFilePath, type: 'tar.gz' };
			// 3. Import backup into local site
			const result = await getIpcApi().importSite( { id: localSiteId, backupFile } );
			// 4. Remove backup file
			await getIpcApi().removeSyncBackup( remoteSiteId );
			return result;
		} catch ( error ) {
			return rejectWithValue( error );
		}
	}
);

/**
 * Exports a local site to a backup archive for upload to a remote site.
 * @param localSiteId - The local site ID (string)
 */
export const pushSite = createAsyncThunk(
	'syncSites/pushSite',
	async ( { localSiteId }: { localSiteId: string }, { rejectWithValue } ) => {
		try {
			// 1. Export local site to backup
			const archiveInfo = await getIpcApi().exportSiteToPush( localSiteId );
			// 2. Return archive info for upload (caller must handle upload and cleanup)
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
			// Return the updated list of connected sites
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
		setIsSyncSitesSelectorOpen( state, action: PayloadAction< IsSyncSitesSelectorOpen > ) {
			state.isSyncSitesSelectorOpen = action.payload;
		},
		closeSyncSitesSelector( state ) {
			state.isSyncSitesSelectorOpen = false;
		},
		// TODO: add reducers for updating pull/push state, etc.
	},
	extraReducers: ( builder ) => {
		builder
			// loadConnectedSites
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
			// refetchSites
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
			// connectSite
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
			// disconnectSite
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
			// updateSiteTimestamp
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
			// pullSite
			.addCase( pullSite.pending, ( state ) => {
				state.isFetching = true;
				state.error = null;
			} )
			.addCase( pullSite.fulfilled, ( state ) => {
				state.isFetching = false;
			} )
			.addCase( pullSite.rejected, ( state, action ) => {
				state.isFetching = false;
				state.error = {
					message: String( action.error.message || 'Failed to pull site' ),
					code: action.error.code,
				};
			} )
			// pushSite
			.addCase( pushSite.pending, ( state ) => {
				state.isFetching = true;
				state.error = null;
			} )
			.addCase( pushSite.fulfilled, ( state ) => {
				state.isFetching = false;
			} )
			.addCase( pushSite.rejected, ( state, action ) => {
				state.isFetching = false;
				state.error = {
					message: String( action.error.message || 'Failed to push site' ),
					code: action.error.code,
				};
			} );
	},
} );

export const syncSitesActions = syncSitesSlice.actions;
export const { reducer: syncSitesReducer } = syncSitesSlice;

// Selectors
export const selectIsFetching = ( state: RootState ) => state.syncSites.isFetching;
export const selectError = ( state: RootState ) => state.syncSites.error;
export const selectConnectedSites = ( state: RootState ) => state.syncSites.connectedSites;
export const selectSyncSites = ( state: RootState ) => state.syncSites.syncSites;
export const selectIsSyncSitesSelectorOpen = ( state: RootState ) =>
	state.syncSites.isSyncSitesSelectorOpen;
