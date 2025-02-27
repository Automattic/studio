import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import { z, ZodError } from 'zod';

const MINIMUM_WORDPRESS_VERSION = '5.9.9';

const wordPressOfferSchema = z.object( {
	version: z.string(),
	response: z.enum( [ 'autoupdate', 'upgrade' ] ),
} );

const wordPressApiResponseSchema = z.object( {
	offers: z.array( wordPressOfferSchema ),
} );

interface WordPressVersion {
	version: string;
	isBeta: boolean;
}

interface WordPressVersionsState {
	versions: WordPressVersion[];
	status: 'idle' | 'loading' | 'succeeded' | 'failed';
	error: string | null;
}

const initialState: WordPressVersionsState = {
	versions: [],
	status: 'idle',
	error: null,
};

export const fetchWordPressVersions = createAsyncThunk(
	'wordpressVersions/fetchWordPressVersions',
	async () => {
		try {
			const response = await fetch(
				`https://api.wordpress.org/core/version-check/1.7/?channel=beta&version=${ MINIMUM_WORDPRESS_VERSION }`
			);
			if ( ! response.ok ) {
				throw new Error( 'Failed to fetch WordPress versions' );
			}
			const rawData = await response.json();
			const data = wordPressApiResponseSchema.parse( rawData );

			const offers = data.offers
				.filter( ( offer ) => offer.response === 'autoupdate' )
				.map( ( offer ) => ( {
					version: offer.version,
					isBeta: offer.version.includes( 'beta' ) || offer.version.includes( 'RC' ),
				} ) );
			return offers;
		} catch ( error ) {
			if ( error instanceof ZodError ) {
				Sentry.captureException( error );
			}
			throw error;
		}
	}
);

const wordpressVersionsSlice = createSlice( {
	name: 'wordpressVersions',
	initialState,
	reducers: {},
	extraReducers: ( builder ) => {
		builder
			.addCase( fetchWordPressVersions.pending, ( state ) => {
				state.status = 'loading';
			} )
			.addCase( fetchWordPressVersions.fulfilled, ( state, action ) => {
				state.status = 'succeeded';
				if ( action.payload.length > 0 ) {
					state.versions = action.payload;
				}
			} )
			.addCase( fetchWordPressVersions.rejected, ( state, action ) => {
				state.status = 'failed';
				state.error =
					action.error.message || 'Something went wrong when fetching the WordPress versions';
			} );
	},
	selectors: {
		selectWordPressVersions: ( state ) => state.versions,
	},
} );

export const wordpressVersionsActions = wordpressVersionsSlice.actions;
export const wordpressVersionsSelectors = wordpressVersionsSlice.selectors;
export const wordpressVersionsThunks = {
	fetchWordPressVersions,
};

export const reducer = wordpressVersionsSlice.reducer;
