import { createSlice, createAsyncThunk, createSelector } from '@reduxjs/toolkit';
import * as semver from 'semver';
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
			( lastSeenVersion, currentVersion ) => {
				if ( ! currentVersion || ! lastSeenVersion ) {
					return !! currentVersion && lastSeenVersion !== currentVersion;
				}

				try {
					const cleanLastSeen = semver.valid( semver.coerce( lastSeenVersion ) );
					const cleanCurrent = semver.valid( semver.coerce( currentVersion ) );

					if ( ! cleanLastSeen || ! cleanCurrent ) {
						return false;
					}

					const lastSeenParts = semver.parse( cleanLastSeen );
					const currentParts = semver.parse( cleanCurrent );

					if ( ! lastSeenParts || ! currentParts ) {
						return false;
					}

					return (
						lastSeenParts.major !== currentParts.major || lastSeenParts.minor !== currentParts.minor
					);
				} catch ( error ) {
					console.error( 'Error comparing versions:', error );
					return lastSeenVersion !== currentVersion;
				}
			}
		),
	},
} );

export const appVersionSelectors = appVersionSlice.selectors;

export const appVersionThunks = { fetchLastSeenVersion, saveLastSeenVersion };
export const reducer = appVersionSlice.reducer;
