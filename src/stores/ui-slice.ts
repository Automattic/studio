import { createSlice } from '@reduxjs/toolkit';
import { RootState } from 'src/stores';

interface UiState {
	isAddSiteModalOpen: boolean;
}

const initialState: UiState = {
	isAddSiteModalOpen: false,
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
	},
} );

export const { openAddSiteModal, closeAddSiteModal, toggleAddSiteModal } = uiSlice.actions;

export const selectIsAddSiteModalOpen = ( state: RootState ) => state.ui.isAddSiteModalOpen;

export default uiSlice.reducer;
