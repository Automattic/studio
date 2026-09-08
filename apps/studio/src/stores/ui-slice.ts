import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { RootState } from 'src/stores';

type UiState = {
	isAddSiteModalOpen: boolean;
	isWapuuWorldOpen: boolean;
	// Credits confirmed to have landed since the app opened. Session-only on
	// purpose: this reports one purchase, not a standing preference.
	aiCreditsAdded: number | null;
};

const initialState: UiState = {
	isAddSiteModalOpen: false,
	isWapuuWorldOpen: false,
	aiCreditsAdded: null,
};

const uiSlice = createSlice( {
	name: 'ui',
	initialState,
	reducers: {
		openAddSiteModal: ( state ) => {
			state.isAddSiteModalOpen = true;
		},
		closeAddSiteModal: ( state ) => {
			state.isAddSiteModalOpen = false;
		},
		toggleAddSiteModal: ( state ) => {
			state.isAddSiteModalOpen = ! state.isAddSiteModalOpen;
		},
		openWapuuWorld: ( state ) => {
			state.isWapuuWorldOpen = true;
		},
		closeWapuuWorld: ( state ) => {
			state.isWapuuWorldOpen = false;
		},
		setAiCreditsAdded: ( state, action: PayloadAction< number | null > ) => {
			state.aiCreditsAdded = action.payload;
		},
	},
} );

export const {
	openAddSiteModal,
	closeAddSiteModal,
	openWapuuWorld,
	closeWapuuWorld,
	setAiCreditsAdded,
} = uiSlice.actions;

export const selectIsAddSiteModalOpen = ( state: RootState ) => state.ui.isAddSiteModalOpen;
export const selectIsWapuuWorldOpen = ( state: RootState ) => state.ui.isWapuuWorldOpen;
export const selectAiCreditsAdded = ( state: RootState ) => state.ui.aiCreditsAdded;

export default uiSlice.reducer;
