import { createSlice, createAsyncThunk, createSelector } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import { __ } from '@wordpress/i18n';
import { z, ZodError } from 'zod';

const MINIMUM_WORDPRESS_VERSION = '5.9.9';

const wordPressOfferSchema = z.object( {
	version: z.string(),
	response: z.string(),
} );

type WordPressOffer = z.infer< typeof wordPressOfferSchema >;

const wordPressApiResponseSchema = z.object( {
	offers: z.array( z.any() ),
} );

type WordPressApiOffer = {
	version: string;
	response?: string;
	[ key: string ]: unknown;
};

const extractShortName = ( version: string ): string => {
	// Development versions have patterns like "6.8-beta2-59979"
	if ( version.match( /^\d+\.\d+-[a-zA-Z0-9]+-\d+$/ ) ) {
		return 'nightly';
	}
	const match = version.match( /^(\d+\.\d+)/ );
	return match ? match[ 1 ] : version;
};

export const fetchWordPressVersions = createAsyncThunk(
	'wordpressVersions/fetchWordPressVersions',
	async () => {
		try {
			const [ stableResponse, developmentResponse ] = await Promise.all( [
				fetch(
					`https://api.wordpress.org/core/version-check/1.7/?channel=beta&version=${ MINIMUM_WORDPRESS_VERSION }`
				),
				fetch( 'https://api.wordpress.org/core/version-check/1.7/?channel=development' ),
			] );

			if ( ! stableResponse.ok || ! developmentResponse.ok ) {
				throw new Error( 'Failed to fetch WordPress versions' );
			}

			const stableData = wordPressApiResponseSchema.parse( await stableResponse.json() );
			const developmentData = wordPressApiResponseSchema.parse( await developmentResponse.json() );

			const shortNameOccurrences = new Map< string, number >();
			const processOffers = ( offers: WordPressApiOffer[], isDevelopment = false ) =>
				offers
					.map( ( offer ) => {
						try {
							return wordPressOfferSchema.parse( offer );
						} catch ( error ) {
							return null;
						}
					} )
					.filter( ( offer ): offer is WordPressOffer =>
						isDevelopment ? offer?.response === 'development' : offer?.response === 'autoupdate'
					)
					.map( ( { version } ) => {
						const shortName = extractShortName( version );
						shortNameOccurrences.set(
							shortName,
							( shortNameOccurrences.get( shortName ) || 0 ) + 1
						);
						return {
							version,
							shortName,
						};
					} );

			const stableOffers = processOffers( stableData.offers );
			const developmentOffers = processOffers( developmentData.offers, true ).slice( 0, 1 );

			const allOffers = [ ...developmentOffers, ...stableOffers ];

			return allOffers.map( ( { version, shortName } ) => {
				const isBeta = version.includes( 'beta' ) || version.includes( 'RC' );
				const isDevelopment = version.match( /^\d+\.\d+-[a-zA-Z0-9]+-\d+$/ ) !== null;
				const occurrences = shortNameOccurrences.get( shortName ) || 0;
				return {
					isBeta,
					isNightly: isDevelopment,
					label: isDevelopment ? 'nightly' : occurrences > 1 || isBeta ? version : shortName,
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
	isNightly: boolean;
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
		selectWordPressVersionsWithLatest: createSelector(
			[ ( state ) => state.versions ],
			( versions: WordPressVersion[] ) => {
				let foundLatestStable = false;
				return versions.map( ( version: WordPressVersion ) => {
					if ( ! foundLatestStable && ! version.isBeta ) {
						foundLatestStable = true;
						return {
							...version,
							label: `${ version.label } (${ __( 'latest' ) })`,
						};
					}
					return version;
				} );
			}
		),
		selectLatestStableVersion: createSelector(
			[ ( state ) => state.versions ],
			( versions: WordPressVersion[] ) =>
				versions.find( ( version: WordPressVersion ) => ! version.isBeta )
		),
	},
} );

export const wordpressVersionsActions = wordpressVersionsSlice.actions;
export const wordpressVersionsSelectors = wordpressVersionsSlice.selectors;
export const wordpressVersionsThunks = {
	fetchWordPressVersions,
};

export const reducer = wordpressVersionsSlice.reducer;
