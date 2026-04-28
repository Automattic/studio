import { createSlice } from '@reduxjs/toolkit';
import { RootState } from 'src/stores';

type UiState = {
	isAddSiteModalOpen: boolean;
	isEasterEggOpen: boolean;
};

const initialState: UiState = {
	isAddSiteModalOpen: false,
	isEasterEggOpen: false,
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
		openEasterEgg: ( state ) => {
			state.isEasterEggOpen = true;
		},
		closeEasterEgg: ( state ) => {
			state.isEasterEggOpen = false;
		},
	},
} );

export const { openAddSiteModal, closeAddSiteModal, openEasterEgg, closeEasterEgg } =
	uiSlice.actions;

export const selectIsAddSiteModalOpen = ( state: RootState ) => state.ui.isAddSiteModalOpen;
export const selectIsEasterEggOpen = ( state: RootState ) => state.ui.isEasterEggOpen;

export default uiSlice.reducer;
