import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { RootState } from 'src/stores';

interface ProviderConstantsState {
	defaultPhpVersion: string;
	defaultWordPressVersion: string;
	allowedPhpVersions: string[];
	minimumWordPressVersion: string;
}

const initialState: ProviderConstantsState = {
	defaultPhpVersion: '',
	defaultWordPressVersion: '',
	allowedPhpVersions: [],
	minimumWordPressVersion: '',
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
export const selectMinimumWordPressVersion = ( state: RootState ) =>
	state.providerConstants.minimumWordPressVersion;
export const selectProviderConstants = ( state: RootState ) => state.providerConstants;

export default providerConstantsSlice.reducer;
