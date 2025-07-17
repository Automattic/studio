import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { RootState } from 'src/stores';

interface ProviderConstantsState {
	defaultPhpVersion: string;
	defaultWordPressVersion: string;
	allowedPhpVersions: string[];
}

const initialState: ProviderConstantsState = {
	// Set reasonable defaults until provider constants are loaded
	defaultPhpVersion: '8.3',
	defaultWordPressVersion: 'latest',
	allowedPhpVersions: [ '8.4', '8.3', '8.2', '8.1', '8.0', '7.4' ],
};

const providerConstantsSlice = createSlice( {
	name: 'providerConstants',
	initialState,
	reducers: {
		setProviderConstants: ( state, action: PayloadAction< ProviderConstantsState > ) => {
			return action.payload;
		},
	},
} );

export const { setProviderConstants } = providerConstantsSlice.actions;

// Selectors
export const selectDefaultPhpVersion = ( state: RootState ) =>
	state.providerConstants.defaultPhpVersion;
export const selectDefaultWordPressVersion = ( state: RootState ) =>
	state.providerConstants.defaultWordPressVersion;
export const selectAllowedPhpVersions = ( state: RootState ) =>
	state.providerConstants.allowedPhpVersions;
export const selectProviderConstants = ( state: RootState ) => state.providerConstants;

export default providerConstantsSlice.reducer;
