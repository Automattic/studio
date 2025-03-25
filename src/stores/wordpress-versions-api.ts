import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import * as Sentry from '@sentry/electron/renderer';
import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { isWordPressDevVersion, isWordPressBetaVersion } from 'src/lib/wordpress-version-utils';
import { withOfflineCheck } from 'src/stores/tests/utils/with-offline-check';

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

export interface WordPressVersion {
	isBeta: boolean;
	isDevelopment: boolean;
	isLatest: boolean;
	label: string;
	value: string;
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

function generateVersionLabel(
	version: string,
	shortName: string,
	occurrences: number,
	isLatest: boolean
): string {
	if ( isWordPressDevVersion( version ) ) {
		return 'nightly';
	}
	if ( isLatest ) {
		return sprintf( __( '%s (latest)' ), version );
	}
	if ( occurrences > 1 || isWordPressBetaVersion( version ) ) {
		return version;
	}
	return shortName;
}

function findLatestStable( versions: ProcessedOffer[] ): ProcessedOffer | undefined {
	return versions.find(
		( version: ProcessedOffer ) =>
			! isWordPressBetaVersion( version.version ) && ! isWordPressDevVersion( version.version )
	);
}

export const wordpressVersionsApi = createApi( {
	reducerPath: 'wordpressVersionsApi',
	baseQuery: fetchBaseQuery( { baseUrl: 'https://api.wordpress.org' } ),
	endpoints: ( builder ) => ( {
		getWordPressVersions: builder.query< WordPressVersion[], void >( {
			query: () => ( {
				url: `/core/version-check/1.7/?channel=beta&version=${ MINIMUM_WORDPRESS_VERSION }`,
			} ),
			transformResponse: async ( response: unknown ) => {
				try {
					const stableData = wordPressApiResponseSchema.parse( response );

					const devResponse = await fetch(
						'https://api.wordpress.org/core/version-check/1.7/?channel=development'
					);

					const developmentData = wordPressApiResponseSchema.parse( await devResponse.json() );

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
					const latestVersion = findLatestStable( allOffers );
					return allOffers.map( ( { version, shortName } ) => {
						const isLatest = latestVersion?.version === version;
						return {
							isBeta: isWordPressBetaVersion( version ),
							isDevelopment: isWordPressDevVersion( version ),
							isLatest,
							label: generateVersionLabel(
								version,
								shortName,
								shortNameOccurrences.get( shortName ) || 0,
								isLatest
							),
							value: version,
						};
					} );
				} catch ( error ) {
					if ( error instanceof z.ZodError ) {
						Sentry.captureException( error );
					}
					throw error;
				}
			},
		} ),
	} ),
} );

const { useGetWordPressVersionsQuery } = wordpressVersionsApi;
export const useGetWordPressVersions = withOfflineCheck( useGetWordPressVersionsQuery );
