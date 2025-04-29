import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { getIpcApi } from 'src/lib/get-ipc-api';

type InstalledAppsState = InstalledApps & InstalledTerminals;

const initialState: InstalledAppsState = {
	vscode: false,
	phpstorm: false,
	webstorm: false,
	windsurf: false,
	cursor: false,
	iterm: false,
	terminal: false,
};

export const fetchInstalledApps = createAsyncThunk(
	'installedApps/fetchInstalledApps',
	async () => {
		const installedApps = await getIpcApi().getInstalledApps();
		return installedApps;
	}
);

const installedAppsSlice = createSlice( {
	name: 'installedApps',
	initialState,
	reducers: {},
	extraReducers: ( builder ) => {
		builder.addCase( fetchInstalledApps.fulfilled, ( state, action ) => {
			// Update the state with the fetched installed apps
			Object.assign( state, action.payload );
		} );
	},
} );

export const installedAppsActions = installedAppsSlice.actions;
export const reducer = installedAppsSlice.reducer;
export const selectInstalledApps = ( state: { installedApps: InstalledApps } ) =>
	state.installedApps;
