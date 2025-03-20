import { createSlice, createAsyncThunk, createSelector } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import { __ } from '@wordpress/i18n';
import { z, ZodError } from 'zod';
import { isWordPressDevVersion, isWordPressBetaVersion } from 'src/lib/wordpress-version-utils';

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

type ProcessedOffer = {
	version: string;
	shortName: string;
};

const extractShortName = ( version: string ): string => {
	if ( isWordPressDevVersion( version ) ) {
		return 'nightly';
	}
	const match = version.match( /^(\d+\.\d+)/ );
	return match ? match[ 1 ] : version;
};

async function fetchWordPressApiData( channel: 'beta' | 'development', version?: string ) {
	const baseUrl = 'https://api.wordpress.org/core/version-check/1.7/';
	const params = new URLSearchParams( { channel } );

	if ( channel === 'beta' && version ) {
		params.append( 'version', version );
	}

	const response = await fetch( `${ baseUrl }?${ params }` );
	if ( ! response.ok ) {
		throw new Error( 'Failed to fetch WordPress versions' );
	}
	return wordPressApiResponseSchema.parse( await response.json() );
}

function processWordPressOffers(
	offers: WordPressApiOffer[],
	isDevelopment = false,
	shortNameOccurrences: Map< string, number >
): ProcessedOffer[] {
	return offers
		.map( ( offer ) => wordPressOfferSchema.safeParse( offer ) )
		.filter( ( result ): result is { success: true; data: WordPressOffer } => result.success )
		.filter( ( result ) =>
			isDevelopment ? result.data.response === 'development' : result.data.response === 'autoupdate'
		)
		.map( ( { data } ) => {
			const shortName = extractShortName( data.version );
			shortNameOccurrences.set( shortName, ( shortNameOccurrences.get( shortName ) || 0 ) + 1 );
			return {
				version: data.version,
				shortName,
			};
		} );
}

function generateVersionLabel( version: string, shortName: string, occurrences: number ): string {
	if ( isWordPressDevVersion( version ) ) {
		return 'nightly';
	}
	return occurrences > 1 || isWordPressBetaVersion( version ) ? version : shortName;
}

export const fetchWordPressVersions = createAsyncThunk(
	'wordpressVersions/fetchWordPressVersions',
	async () => {
		try {
			const [ stableData, developmentData ] = await Promise.all( [
				fetchWordPressApiData( 'beta', MINIMUM_WORDPRESS_VERSION ),
				fetchWordPressApiData( 'development' ),
			] );

			const shortNameOccurrences = new Map< string, number >();

			const stableOffers = processWordPressOffers( stableData.offers, false, shortNameOccurrences );

			const developmentOffer = processWordPressOffers(
				developmentData.offers,
				true,
				shortNameOccurrences
			)[ 0 ];

			const allOffers = developmentOffer ? [ developmentOffer, ...stableOffers ] : stableOffers;

			return allOffers.map( ( { version, shortName } ) => ( {
				isBeta: isWordPressBetaVersion( version ),
				isDevelopment: isWordPressDevVersion( version ),
				label: generateVersionLabel(
					version,
					shortName,
					shortNameOccurrences.get( shortName ) || 0
				),
				value: version,
			} ) );
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
	isDevelopment: boolean;
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
					if ( ! foundLatestStable && ! version.isBeta && ! version.isDevelopment ) {
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
				versions.find(
					( version: WordPressVersion ) => ! version.isBeta && ! version.isDevelopment
				)
		),
	},
} );

export const wordpressVersionsActions = wordpressVersionsSlice.actions;
export const wordpressVersionsSelectors = wordpressVersionsSlice.selectors;
export const wordpressVersionsThunks = {
	fetchWordPressVersions,
};

export const reducer = wordpressVersionsSlice.reducer;
