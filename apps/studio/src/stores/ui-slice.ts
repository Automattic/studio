import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AiCreditsMeterIntent } from '@studio/common/lib/studio-assistant-quota';
import type { RootState } from 'src/stores';

type UiState = {
	isAddSiteModalOpen: boolean;
	isWapuuWorldOpen: boolean;
	// AI credits notice state, session-only on purpose: a threshold notice
	// describes the balance right now, not a standing preference.
	dismissedAiCreditsIntent: AiCreditsMeterIntent | null;
	// Credits confirmed to have landed since the app opened. Session-only on
	// purpose: this reports one purchase, not a standing preference.
	aiCreditsAdded: number | null;
};

const initialState: UiState = {
	isAddSiteModalOpen: false,
	isWapuuWorldOpen: false,
	dismissedAiCreditsIntent: null,
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
		setDismissedAiCreditsIntent: (
			state,
			action: PayloadAction< AiCreditsMeterIntent | null >
		) => {
			state.dismissedAiCreditsIntent = action.payload;
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
	setDismissedAiCreditsIntent,
	setAiCreditsAdded,
} = uiSlice.actions;

export const selectIsAddSiteModalOpen = ( state: RootState ) => state.ui.isAddSiteModalOpen;
export const selectIsWapuuWorldOpen = ( state: RootState ) => state.ui.isWapuuWorldOpen;
export const selectDismissedAiCreditsIntent = ( state: RootState ) =>
	state.ui.dismissedAiCreditsIntent;
export const selectAiCreditsAdded = ( state: RootState ) => state.ui.aiCreditsAdded;

export default uiSlice.reducer;
