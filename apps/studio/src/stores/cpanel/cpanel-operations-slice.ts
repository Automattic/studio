import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { __ } from '@wordpress/i18n';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';
import type { CpanelPullState, CpanelPullStatusInfo } from 'src/modules/cpanel/types';

// Subscribe to cPanel pull progress IPC events emitted by the main process
// and mirror them into Redux state.
window.ipcListener.subscribe( 'cpanel-pull-progress', ( _event, payload ) => {
	const { localSiteId, cpanelSiteId, status } = payload;
	store.dispatch(
		cpanelOperationsActions.updatePullState( {
			localSiteId,
			cpanelSiteId,
			state: { status },
		} )
	);
} );

export function getCpanelPullStatesProgressInfo(): Record<
	CpanelPullStatusInfo[ 'key' ],
	CpanelPullStatusInfo
> {
	return {
		compressing: {
			key: 'compressing',
			progress: 10,
			message: __( 'Compressing files on server…' ),
		},
		downloading: { key: 'downloading', progress: 30, message: __( 'Downloading files…' ) },
		'exporting-db': { key: 'exporting-db', progress: 55, message: __( 'Exporting database…' ) },
		'building-archive': {
			key: 'building-archive',
			progress: 65,
			message: __( 'Building archive…' ),
		},
		importing: { key: 'importing', progress: 75, message: __( 'Importing into local site…' ) },
		finished: { key: 'finished', progress: 100, message: __( 'Pull complete' ) },
		failed: { key: 'failed', progress: 100, message: __( 'Error pulling site' ) },
		cancelled: { key: 'cancelled', progress: 0, message: __( 'Pull cancelled' ) },
	};
}

type CpanelOperationsState = {
	pullStates: Record< string, CpanelPullState >;
};

const initialState: CpanelOperationsState = {
	pullStates: {},
};

function stateKey( localSiteId: string, cpanelSiteId: string ): string {
	return `${ localSiteId }-${ cpanelSiteId }`;
}

const cpanelOperationsSlice = createSlice( {
	name: 'cpanelOperations',
	initialState,
	reducers: {
		updatePullState: (
			state,
			action: PayloadAction< {
				localSiteId: string;
				cpanelSiteId: string;
				state: Partial< CpanelPullState >;
			} >
		) => {
			const { localSiteId, cpanelSiteId, state: update } = action.payload;
			const key = stateKey( localSiteId, cpanelSiteId );
			state.pullStates[ key ] = {
				...state.pullStates[ key ],
				...update,
				cpanelSiteId,
			};
		},

		clearPullState: (
			state,
			action: PayloadAction< { localSiteId: string; cpanelSiteId: string } >
		) => {
			const { localSiteId, cpanelSiteId } = action.payload;
			delete state.pullStates[ stateKey( localSiteId, cpanelSiteId ) ];
		},
	},
} );

export const cpanelOperationsActions = cpanelOperationsSlice.actions;
export const cpanelOperationsReducer = cpanelOperationsSlice.reducer;

export const cpanelOperationsSelectors = {
	selectPullState:
		( localSiteId: string, cpanelSiteId: string ) =>
		( state: { cpanelOperations: CpanelOperationsState } ) =>
			state.cpanelOperations.pullStates[ stateKey( localSiteId, cpanelSiteId ) ],

	selectIsAnySitePulling: ( state: { cpanelOperations: CpanelOperationsState } ) =>
		Object.values( state.cpanelOperations.pullStates ).some( ( s ) =>
			[ 'compressing', 'downloading', 'exporting-db', 'building-archive', 'importing' ].includes(
				s.status.key
			)
		),
};

// ---------------------------------------------------------------------------
// Async thunks
// ---------------------------------------------------------------------------

const pullCpanelSiteThunk = createAsyncThunk<
	void,
	{ cpanelSiteId: string; localSiteId: string; selectedSite: SiteDetails },
	{ rejectValue: { title: string; message: string } }
>(
	'cpanelOperations/pullSite',
	async ( { cpanelSiteId, localSiteId, selectedSite }, { dispatch, rejectWithValue } ) => {
		dispatch(
			cpanelOperationsActions.updatePullState( {
				localSiteId,
				cpanelSiteId,
				state: {
					selectedSite,
					status: getCpanelPullStatesProgressInfo().compressing,
				},
			} )
		);

		try {
			await getIpcApi().pullCpanelSite( cpanelSiteId, localSiteId );
		} catch ( error ) {
			return rejectWithValue( {
				title: __( 'Failed to pull cPanel site' ),
				message:
					error instanceof Error
						? error.message
						: __( 'An unexpected error occurred. Please try again.' ),
			} );
		}
	}
);

const cancelCpanelPullThunk = createAsyncThunk(
	'cpanelOperations/cancelPull',
	async ( { localSiteId, cpanelSiteId }: { localSiteId: string; cpanelSiteId: string } ) => {
		getIpcApi().cancelCpanelPull( localSiteId, cpanelSiteId );
	}
);

export const cpanelOperationsThunks = {
	pullSite: pullCpanelSiteThunk,
	cancelPull: cancelCpanelPullThunk,
};
