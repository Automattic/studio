import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import * as Sentry from '@sentry/electron/renderer';
import {
	isWordPressDevVersion,
	isWordPressBetaVersion,
} from '@studio/common/lib/wordpress-version-utils';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { withOfflineCheck } from 'src/stores/utils/with-offline-check';

const wordPressApiResponseSchema = z.object( {
	offers: z.array( z.any() ),
} );

function findLatestStable( versions: ProcessedOffer[] ): ProcessedOffer | undefined {
	return versions.find(
		( version: ProcessedOffer ) =>
			! isWordPressBetaVersion( version.version ) && ! isWordPressDevVersion( version.version )
	);
}

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

const wordPressOfferSchema = z.object( {
	version: z.string(),
	response: z.string(),
} );

type WordPressOffer = z.infer< typeof wordPressOfferSchema >;

type WordPressApiOffer = {
	version: string;
	response?: string;
	[ key: string ]: unknown;
};

type ProcessedOffer = {
	version: string;
	shortName: string;
};

function processWordPressOffers(
	offers: WordPressApiOffer[],
	isDevelopment = false,
	shortNameOccurrences: Map< string, number >
): ProcessedOffer[] {
	// We extract the shortName (major.minor) for each version to later calculate duplicates. e.g. 6.4.1 -> 6.4
	const extractShortName = ( version: string ): string => {
		if ( isWordPressDevVersion( version ) ) {
			return 'nightly';
		}
		const match = version.match( /^(\d+\.\d+)/ );
		return match ? match[ 1 ] : version;
	};

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

function generateVersionLabel(
	version: string,
	shortName: string,
	shortNameOccurrences: number
): string {
	if ( isWordPressDevVersion( version ) ) {
		return 'nightly';
	}

	// If is beta or there are two or more versions with the same major.minor versions, we show the full version.
	// 6.4.1 and 6.4.2 will have the same shortName (6.4), so we'll show the full version.
	if ( shortNameOccurrences > 1 || isWordPressBetaVersion( version ) ) {
		return version;
	}
	return shortName;
}

type WordPressVersion = {
	isBeta: boolean;
	isDevelopment: boolean;
	label: string;
	value: string;
};

export const wordpressVersionsApi = createApi( {
	reducerPath: 'wordpressVersionsApi',
	baseQuery: fetchBaseQuery(),
	endpoints: ( builder ) => ( {
		getWordPressVersions: builder.query< WordPressVersion[], { minimumVersion: string } >( {
			queryFn: async ( { minimumVersion } ) => {
				let stableData, developmentData;
				try {
					[ stableData, developmentData ] = await Promise.all( [
						fetchWordPressApiData( 'beta', minimumVersion ),
						fetchWordPressApiData( 'development' ),
					] );
				} catch ( error ) {
					if ( error instanceof z.ZodError ) {
						Sentry.captureException( error );
					}
					throw error;
				}

				const shortNameOccurrences = new Map< string, number >();

				const stableOffers = processWordPressOffers(
					stableData.offers,
					false,
					shortNameOccurrences
				);

				const developmentOffer = processWordPressOffers(
					developmentData.offers,
					true,
					shortNameOccurrences
				)[ 0 ];

				const allOffers = developmentOffer ? [ developmentOffer, ...stableOffers ] : stableOffers;
				const latestStable = findLatestStable( allOffers );

				const versionsList = allOffers.map( ( { version, shortName } ) => ( {
					isBeta: isWordPressBetaVersion( version ),
					isDevelopment: isWordPressDevVersion( version ),
					label: generateVersionLabel(
						version,
						shortName,
						shortNameOccurrences.get( shortName ) || 0
					),
					value: version,
				} ) );

				if ( latestStable ) {
					versionsList.unshift( {
						isBeta: false,
						isDevelopment: false,
						label: generateVersionLabel(
							latestStable.version,
							latestStable.shortName,
							shortNameOccurrences.get( latestStable.shortName ) || 0
						),
						value: 'latest',
					} );
				}

				return {
					data: versionsList,
				};
			},
		} ),
	} ),
} );

const { useGetWordPressVersionsQuery } = wordpressVersionsApi;
export const useGetWordPressVersions = withOfflineCheck( useGetWordPressVersionsQuery );
