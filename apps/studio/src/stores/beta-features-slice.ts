import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';

type BetaFeaturesState = {
	features: BetaFeatures;
	loading: boolean;
};

const initialState: BetaFeaturesState = {
	features: { remoteSession: false },
	loading: false,
};

export const loadBetaFeatures = createAsyncThunk( 'betaFeatures/load', async () => {
	const features = await getIpcApi().getBetaFeatures();
	return features;
} );

const betaFeaturesSlice = createSlice( {
	name: 'betaFeatures',
	initialState,
	reducers: {
		setBetaFeatures: ( state, action: PayloadAction< BetaFeatures > ) => {
			state.features = action.payload;
		},
	},
	extraReducers: ( builder ) => {
		builder
			.addCase( loadBetaFeatures.pending, ( state ) => {
				state.loading = true;
			} )
			.addCase( loadBetaFeatures.fulfilled, ( state, action ) => {
				state.features = action.payload;
				state.loading = false;
			} )
			.addCase( loadBetaFeatures.rejected, ( state ) => {
				state.loading = false;
			} );
	},
} );

window.ipcListener.subscribe( 'beta-features-updated', () => {
	void store.dispatch( loadBetaFeatures() );
} );

export const betaFeaturesReducer = betaFeaturesSlice.reducer;
