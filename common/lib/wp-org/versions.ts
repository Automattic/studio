import { z } from 'zod';

// WordPress.org API constants
const MINIMUM_WORDPRESS_VERSION = '5.9.9';
const WORDPRESS_API_BASE_URL = 'https://api.wordpress.org/core/version-check/1.7/';

// Schemas for WordPress.org API responses
const wordPressApiResponseSchema = z.object( {
	offers: z.array( z.any() ),
} );

const wordPressOfferSchema = z.object( {
	version: z.string(),
	response: z.string(),
} );

// Types
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

export interface WordPressVersion {
	isBeta: boolean;
	isDevelopment: boolean;
	label: string;
	value: string;
}

// WordPress version utility functions
function isWordPressDevVersion( version: string ): boolean {
	// Match nightly build patterns that end with a build number
	// Examples: 6.8-alpha1-12345, 6.8-beta2-59979, 6.8-dev-12345, 6.8-59979
	return /^\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9]+)*-\d+$/.test( version );
}

function isWordPressBetaVersion( version: string ): boolean {
	return version.includes( 'beta' ) || version.includes( 'RC' );
}

// Core API fetching functions
async function fetchWordPressApiData( channel: 'beta' | 'development', version?: string ) {
	const params = new URLSearchParams( { channel } );

	if ( channel === 'beta' && version ) {
		params.append( 'version', version );
	}

	const response = await fetch( `${ WORDPRESS_API_BASE_URL }?${ params }` );
	if ( ! response.ok ) {
		throw new Error( 'Failed to fetch WordPress versions' );
	}
	return wordPressApiResponseSchema.parse( await response.json() );
}

function findLatestStable( versions: ProcessedOffer[] ): ProcessedOffer | undefined {
	return versions.find(
		( version: ProcessedOffer ) =>
			! isWordPressBetaVersion( version.version ) && ! isWordPressDevVersion( version.version )
	);
}

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

// Main function to fetch and process WordPress versions
export async function fetchWordPressVersions(): Promise< WordPressVersion[] > {
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
	const latestStable = findLatestStable( allOffers );

	const versionsList = allOffers.map( ( { version, shortName } ) => ( {
		isBeta: isWordPressBetaVersion( version ),
		isDevelopment: isWordPressDevVersion( version ),
		label: generateVersionLabel( version, shortName, shortNameOccurrences.get( shortName ) || 0 ),
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

	return versionsList;
}
