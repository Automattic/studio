import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState } from 'src/stores';

interface OnboardingState {
	completed: boolean;
	loading: boolean;
}

const initialState: OnboardingState = {
	completed: false,
	loading: true,
};

// Async thunk to load onboarding status
export const loadOnboardingStatus = createAsyncThunk( 'onboarding/loadStatus', async () => {
	const completed = await getIpcApi().getOnboardingData();
	return completed;
} );

// Async thunk to save onboarding status
export const saveOnboardingStatus = createAsyncThunk(
	'onboarding/saveStatus',
	async ( completed: boolean ) => {
		await getIpcApi().saveOnboarding( completed );
		return completed;
	}
);

const onboardingSlice = createSlice( {
	name: 'onboarding',
	initialState,
	reducers: {
		setOnboardingCompleted: ( state, action: PayloadAction< boolean > ) => {
			state.completed = action.payload;
		},
	},
	extraReducers: ( builder ) => {
		builder
			.addCase( loadOnboardingStatus.pending, ( state ) => {
				state.loading = true;
			} )
			.addCase( loadOnboardingStatus.fulfilled, ( state, action ) => {
				state.completed = action.payload;
				state.loading = false;
			} )
			.addCase( loadOnboardingStatus.rejected, ( state ) => {
				state.loading = false;
			} )
			.addCase( saveOnboardingStatus.fulfilled, ( state, action ) => {
				state.completed = action.payload;
			} );
	},
} );

export const { setOnboardingCompleted } = onboardingSlice.actions;

// Selectors
export const selectOnboardingCompleted = ( state: RootState ) => state.onboarding.completed;
export const selectOnboardingLoading = ( state: RootState ) => state.onboarding.loading;

export default onboardingSlice.reducer;
