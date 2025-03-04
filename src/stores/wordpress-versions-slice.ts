import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import { z, ZodError } from 'zod';

const MINIMUM_WORDPRESS_VERSION = '5.9.9';

const wordPressOfferSchema = z.object( {
	version: z.string(),
	response: z.enum( [ 'autoupdate', 'development', 'upgrade' ] ),
} );

const wordPressApiResponseSchema = z.object( {
	offers: z.array( wordPressOfferSchema ),
} );

const extractShortName = ( version: string ): string => {
	const match = version.match( /^(\d+\.\d+)/ );
	return match ? match[ 1 ] : version;
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

			const shortNameOccurrences = new Map< string, number >();
			const offers = data.offers
				.filter( ( offer ) => offer.response === 'autoupdate' )
				.map( ( { version } ) => {
					const shortName = extractShortName( version );
					shortNameOccurrences.set( shortName, ( shortNameOccurrences.get( shortName ) || 0 ) + 1 );
					return {
						version,
						shortName,
					};
				} );
			return offers.map( ( { version, shortName } ) => {
				const isBeta = version.includes( 'beta' ) || version.includes( 'RC' );
				const occurrences = shortNameOccurrences.get( shortName ) || 0;
				return {
					isBeta,
					label: occurrences > 1 || isBeta ? version : shortName,
					value: version,
				};
			} );
		} catch ( error ) {
			if ( error instanceof ZodError ) {
				Sentry.captureException( error );
			}
			throw error;
		}
	}
);

interface WordPressVersion {
	isBeta: boolean;
	label: string;
	value: string;
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
				state.versions = action.payload;
				state.error = null;
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
