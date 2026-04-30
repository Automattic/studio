import { createSlice } from '@reduxjs/toolkit';
import { RootState } from 'src/stores';

type UiState = {
	isAddSiteModalOpen: boolean;
	isWapuuWorldOpen: boolean;
};

const initialState: UiState = {
	isAddSiteModalOpen: false,
	isWapuuWorldOpen: false,
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
	},
} );

export const { openAddSiteModal, closeAddSiteModal, openWapuuWorld, closeWapuuWorld } =
	uiSlice.actions;

export const selectIsAddSiteModalOpen = ( state: RootState ) => state.ui.isAddSiteModalOpen;
export const selectIsWapuuWorldOpen = ( state: RootState ) => state.ui.isWapuuWorldOpen;

export default uiSlice.reducer;
