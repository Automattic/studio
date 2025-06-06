import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { I18n, createI18n, defaultI18n } from '@wordpress/i18n';
import {
	SupportedLocale,
	getLocaleData,
	DEFAULT_LOCALE,
	isSupportedLocale,
} from 'common/lib/locale';
import { getIpcApi } from 'src/lib/get-ipc-api';

interface I18nState {
	locale: SupportedLocale;
	i18n: I18n;
}

const initialState: I18nState = {
	locale: DEFAULT_LOCALE,
	i18n: defaultI18n,
};

if ( initialState.i18n ) {
	const initialLocaleData = getLocaleData( DEFAULT_LOCALE );
	defaultI18n.setLocaleData( initialLocaleData?.messages || {}, 'default' );
}

const i18nSlice = createSlice( {
	name: 'i18n',
	initialState,
	reducers: {
		updateLocaleState: ( state, action: PayloadAction< SupportedLocale > ) => {
			const newLocale = action.payload;
			state.locale = newLocale;
			const localeData = getLocaleData( newLocale );

			defaultI18n.setLocaleData( localeData?.messages || {}, 'default' );
			const newI18n = createI18n( localeData?.messages || {}, 'default' );
			state.i18n = newI18n;
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
