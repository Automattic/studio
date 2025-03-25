import { createSlice, createAsyncThunk, createSelector } from '@reduxjs/toolkit';
import { getIpcApi } from 'src/lib/get-ipc-api';

interface AppVersionState {
	lastSeenVersion: string | undefined;
}

export const fetchLastSeenVersion = createAsyncThunk(
	'appVersion/fetchLastSeenVersion',
	async () => {
		try {
			const version = await getIpcApi().getLastSeenVersion();
			return version;
		} catch ( error ) {
			console.error( 'Failed to get last seen version:', error );
			throw error;
		}
	}
);

export const saveLastSeenVersion = createAsyncThunk(
	'appVersion/saveLastSeenVersion',
	async ( version: string ) => {
		try {
			await getIpcApi().saveLastSeenVersion( version );
			return version;
		} catch ( error ) {
			console.error( 'Failed to save last seen version:', error );
			throw error;
		}
	}
);

const appVersionSlice = createSlice( {
	name: 'appVersion',
	initialState: {
		lastSeenVersion: undefined,
	} as AppVersionState,
	reducers: {},
	extraReducers: ( builder ) => {
		builder
			.addCase( fetchLastSeenVersion.fulfilled, ( state, action ) => {
				state.lastSeenVersion = action.payload;
			} )
			.addCase( saveLastSeenVersion.fulfilled, ( state, action ) => {
				state.lastSeenVersion = action.payload;
			} );
	},
	selectors: {
		selectLastSeenVersion: ( state ) => state.lastSeenVersion,
		selectIsNewVersion: createSelector(
			[ ( state ) => state.lastSeenVersion, ( _state, currentVersion: string ) => currentVersion ],
			( lastSeenVersion, currentVersion ) => !! currentVersion && lastSeenVersion !== currentVersion
		),
	},
} );

export const appVersionSelectors = appVersionSlice.selectors;

export const appVersionThunks = { fetchLastSeenVersion, saveLastSeenVersion };
export const reducer = appVersionSlice.reducer;
