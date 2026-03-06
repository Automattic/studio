import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
	DEFAULT_PHP_VERSION,
	DEFAULT_WORDPRESS_VERSION,
	MINIMUM_WORDPRESS_VERSION,
} from '@studio/common/constants';
import { RecommendedPHPVersion, SupportedPHPVersions } from '@studio/common/types/php-versions';
import { RootState } from 'src/stores';

type ProviderConstantsState = {
	defaultPhpVersion: typeof RecommendedPHPVersion;
	defaultWordPressVersion: string;
	allowedPhpVersions: typeof SupportedPHPVersions;
	minimumWordPressVersion: string;
};

const initialState: ProviderConstantsState = {
	defaultPhpVersion: DEFAULT_PHP_VERSION,
	defaultWordPressVersion: DEFAULT_WORDPRESS_VERSION,
	allowedPhpVersions: SupportedPHPVersions,
	minimumWordPressVersion: MINIMUM_WORDPRESS_VERSION,
};

const providerConstantsSlice = createSlice( {
	name: 'providerConstants',
	initialState,
	reducers: {
		setProviderConstants: ( state, action: PayloadAction< Partial< ProviderConstantsState > > ) => {
			return { ...state, ...action.payload };
		},
	},
} );

export const { setProviderConstants } = providerConstantsSlice.actions;

export const selectDefaultPhpVersion = ( state: RootState ) =>
	state.providerConstants.defaultPhpVersion;
export const selectDefaultWordPressVersion = ( state: RootState ) =>
	state.providerConstants.defaultWordPressVersion;
export const selectAllowedPhpVersions = ( state: RootState ) =>
	state.providerConstants.allowedPhpVersions;
export const selectMinimumWordPressVersion = ( state: RootState ) =>
	state.providerConstants.minimumWordPressVersion;

export const providerConstantsReducer = providerConstantsSlice.reducer;
