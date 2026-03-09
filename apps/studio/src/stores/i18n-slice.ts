import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import {
	SupportedLocale,
	getLocaleData,
	DEFAULT_LOCALE,
	isSupportedLocale,
} from '@studio/common/lib/locale';
import { defaultI18n } from '@wordpress/i18n';
import { getIpcApi } from 'src/lib/get-ipc-api';

type I18nState = {
	locale: SupportedLocale;
};

const initialState: I18nState = {
	locale: DEFAULT_LOCALE,
};

const i18nSlice = createSlice( {
	name: 'i18n',
	initialState,
	reducers: {
		updateLocaleState: ( state, action: PayloadAction< SupportedLocale > ) => {
			const newLocale = action.payload;
			const translations = getLocaleData( newLocale )?.messages;
			state.locale = newLocale;

			// Update default I18n data to reflect language change when using
			// I18n functions from `@wordpress/i18n` package.
			// Note we need to update this in both the renderer and main processes.
			if ( translations ) {
				defaultI18n.resetLocaleData();
				defaultI18n.setLocaleData( translations );
				void getIpcApi().setDefaultLocaleData( translations );
			} else {
				// In case we don't find translations, we reset the locale data to
				// fallback to the default translations.
				defaultI18n.resetLocaleData();
				void getIpcApi().resetDefaultLocaleData();
			}

			void getIpcApi().setupAppMenu( { needsOnboarding: false } );
		},
	},
} );

const { updateLocaleState } = i18nSlice.actions;

export const saveUserLocale = createAsyncThunk(
	'i18n/saveUserLocale',
	async ( newLocale: SupportedLocale, { dispatch } ) => {
		try {
			await getIpcApi().saveUserLocale( newLocale );
			dispatch( updateLocaleState( newLocale ) );
			return newLocale;
		} catch ( error ) {
			console.error( 'Failed to save user locale via IPC:', error );
			throw error;
		}
	}
);

export const initializeUserLocale = createAsyncThunk(
	'i18n/initializeUserLocale',
	async ( _, { dispatch } ) => {
		try {
			const userLocale = await getIpcApi().getUserLocale();
			if ( userLocale && isSupportedLocale( userLocale ) ) {
				dispatch( updateLocaleState( userLocale ) );
			}
		} catch ( error ) {
			console.error( 'Failed to initialize user locale:', error );
		}
	}
);

export default i18nSlice.reducer;
