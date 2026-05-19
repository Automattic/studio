import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { __ } from '@wordpress/i18n';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { RemoteSessionStatus } from '@studio/common/lib/remote-session';

/**
 * Remote-session daemon state shared across every consumer (top-bar bolt and
 * the settings toggle). The PID file is the source of truth; this slice is
 * the in-memory cache that the renderer reads from. It's hydrated by:
 *
 *   - `loadRemoteSessionStatus` on app boot,
 *   - the `remote-session-status` IPC event from the main-process poller,
 *   - `startRemoteSession` / `stopRemoteSession` re-fetching after their IPC
 *     calls complete.
 *
 * `optimisticRunning` lets the UI flip instantly when the user clicks; it's
 * reconciled away once the poll/refresh confirms the daemon actually
 * transitioned. `inFlight` is the debounce guard for concurrent clicks.
 */
export type RemoteSessionSliceState = {
	status: RemoteSessionStatus | undefined;
	optimisticRunning: boolean | null;
	isLoading: boolean;
	inFlight: boolean;
};

const initialState: RemoteSessionSliceState = {
	status: undefined,
	optimisticRunning: null,
	isLoading: false,
	inFlight: false,
};

function getErrorMessage( error: unknown ): string {
	if ( error instanceof Error ) {
		return error.message;
	}
	return String( error );
}

export const loadRemoteSessionStatus = createAsyncThunk(
	'remoteSession/load',
	async (): Promise< RemoteSessionStatus > => {
		return await getIpcApi().getRemoteSessionDaemonStatus();
	}
);

type ThunkConfig = { state: { remoteSession: RemoteSessionSliceState } };

export const startRemoteSession = createAsyncThunk< RemoteSessionStatus, void, ThunkConfig >(
	'remoteSession/start',
	async () => {
		try {
			await getIpcApi().startRemoteSessionDaemon();
		} catch ( error ) {
			void getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to start remote session' ),
				message: getErrorMessage( error ),
			} );
		}
		// Always re-read status so the UI reflects reality immediately rather
		// than waiting up to one poll interval — especially important when
		// start errors with "already running" (the daemon IS up and the user
		// shouldn't have to wait for the next tick to see that).
		return await getIpcApi().getRemoteSessionDaemonStatus();
	},
	{
		condition: ( _, { getState } ) => ! getState().remoteSession.inFlight,
	}
);

export const stopRemoteSession = createAsyncThunk< RemoteSessionStatus, void, ThunkConfig >(
	'remoteSession/stop',
	async () => {
		try {
			await getIpcApi().stopRemoteSessionDaemon();
		} catch ( error ) {
			void getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to stop remote session' ),
				message: getErrorMessage( error ),
			} );
		}
		return await getIpcApi().getRemoteSessionDaemonStatus();
	},
	{
		condition: ( _, { getState } ) => ! getState().remoteSession.inFlight,
	}
);

const remoteSessionSlice = createSlice( {
	name: 'remoteSession',
	initialState,
	reducers: {
		applyIncomingStatus( state, action: PayloadAction< RemoteSessionStatus > ) {
			state.status = action.payload;
			// Reconcile only if the poll confirms the optimistic guess;
			// otherwise keep showing the user's intent until the in-flight
			// call returns.
			if (
				state.optimisticRunning !== null &&
				state.optimisticRunning === action.payload.running
			) {
				state.optimisticRunning = null;
			}
		},
	},
	extraReducers: ( builder ) => {
		builder
			.addCase( loadRemoteSessionStatus.fulfilled, ( state, action ) => {
				state.status = action.payload;
				state.optimisticRunning = null;
			} )
			.addCase( startRemoteSession.pending, ( state ) => {
				state.inFlight = true;
				state.isLoading = true;
				state.optimisticRunning = true;
			} )
			.addCase( startRemoteSession.fulfilled, ( state, action ) => {
				state.status = action.payload;
				state.optimisticRunning = null;
				state.isLoading = false;
				state.inFlight = false;
			} )
			.addCase( startRemoteSession.rejected, ( state ) => {
				// Only reached if the post-call refresh itself threw — in that
				// case leave the cached status alone and just clear the
				// transient flags. We don't surface this to the user because
				// the main-process poller will reconcile within one tick.
				state.optimisticRunning = null;
				state.isLoading = false;
				state.inFlight = false;
			} )
			.addCase( stopRemoteSession.pending, ( state ) => {
				state.inFlight = true;
				state.isLoading = true;
				state.optimisticRunning = false;
			} )
			.addCase( stopRemoteSession.fulfilled, ( state, action ) => {
				state.status = action.payload;
				state.optimisticRunning = null;
				state.isLoading = false;
				state.inFlight = false;
			} )
			.addCase( stopRemoteSession.rejected, ( state ) => {
				state.optimisticRunning = null;
				state.isLoading = false;
				state.inFlight = false;
			} );
	},
} );

export const { applyIncomingStatus } = remoteSessionSlice.actions;
export const remoteSessionReducer = remoteSessionSlice.reducer;

// Selectors
type SliceStateProjection = { remoteSession: RemoteSessionSliceState };

export const selectRemoteSessionStatus = ( state: SliceStateProjection ) =>
	state.remoteSession.status;

export const selectRemoteSessionIsRunning = ( state: SliceStateProjection ) =>
	state.remoteSession.optimisticRunning ?? state.remoteSession.status?.running === true;

export const selectRemoteSessionIsLoading = ( state: SliceStateProjection ) =>
	state.remoteSession.isLoading;
