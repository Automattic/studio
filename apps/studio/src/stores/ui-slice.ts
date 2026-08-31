import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AiCreditsMeterIntent } from '@studio/common/lib/studio-assistant-quota';
import type { RootState } from 'src/stores';

type UiState = {
	isAddSiteModalOpen: boolean;
	isWapuuWorldOpen: boolean;
	// AI credits notice state, session-only on purpose: a threshold notice
	// describes the balance right now, not a standing preference.
	dismissedAiCreditsIntent: AiCreditsMeterIntent | null;
};

const initialState: UiState = {
	isAddSiteModalOpen: false,
	isWapuuWorldOpen: false,
	dismissedAiCreditsIntent: null,
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
		setDismissedAiCreditsIntent: (
			state,
			action: PayloadAction< AiCreditsMeterIntent | null >
		) => {
			state.dismissedAiCreditsIntent = action.payload;
		},
	},
} );

export const {
	openAddSiteModal,
	closeAddSiteModal,
	openWapuuWorld,
	closeWapuuWorld,
	setDismissedAiCreditsIntent,
} = uiSlice.actions;

export const selectIsAddSiteModalOpen = ( state: RootState ) => state.ui.isAddSiteModalOpen;
export const selectIsWapuuWorldOpen = ( state: RootState ) => state.ui.isWapuuWorldOpen;
export const selectDismissedAiCreditsIntent = ( state: RootState ) =>
	state.ui.dismissedAiCreditsIntent;

export default uiSlice.reducer;
