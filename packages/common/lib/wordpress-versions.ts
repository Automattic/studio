import { z } from 'zod';
import { DEFAULT_WORDPRESS_VERSION, MINIMUM_WORDPRESS_VERSION } from '@studio/common/constants';
import {
	isWordPressBetaVersion,
	isWordPressDevVersion,
} from '@studio/common/lib/wordpress-version-utils';

const WP_API_BASE_URL = 'https://api.wordpress.org/core/version-check/1.7/';

const responseSchema = z.object( {
	offers: z.array( z.any() ),
} );

const offerSchema = z.object( {
	version: z.string(),
	response: z.string(),
} );

export interface WordPressVersion {
	label: string;
	value: string;
	isBeta: boolean;
	isDevelopment: boolean;
}

async function fetchApiData( channel: 'beta' | 'development', version?: string ) {
	const params = new URLSearchParams( { channel } );
	if ( channel === 'beta' && version ) {
		params.append( 'version', version );
	}
	const response = await fetch( `${ WP_API_BASE_URL }?${ params }` );
	if ( ! response.ok ) {
		throw new Error( 'Failed to fetch WordPress versions' );
	}
	return responseSchema.parse( await response.json() );
}

function extractShortName( version: string ): string {
	if ( isWordPressDevVersion( version ) ) {
		return 'nightly';
	}
	const match = version.match( /^(\d+\.\d+)/ );
	return match ? match[ 1 ] : version;
}

export function generateVersionLabel(
	version: string,
	shortName: string,
	duplicateCount: number
): string {
	if ( isWordPressDevVersion( version ) ) {
		return 'nightly';
	}
	if ( duplicateCount > 1 || isWordPressBetaVersion( version ) ) {
		return version;
	}
	return shortName;
}

type ProcessedOffer = { version: string; shortName: string; isDevelopment: boolean };

function processOffers(
	offers: unknown[],
	isDevelopment: boolean,
	shortNameCounts: Map< string, number >
): ProcessedOffer[] {
	return offers
		.map( ( offer ) => offerSchema.safeParse( offer ) )
		.filter( ( r ) => r.success )
		.filter( ( r ) =>
			isDevelopment ? r.data.response === 'development' : r.data.response === 'autoupdate'
		)
		.map( ( { data } ) => {
			const shortName = extractShortName( data.version );
			shortNameCounts.set( shortName, ( shortNameCounts.get( shortName ) || 0 ) + 1 );
			return { version: data.version, shortName, isDevelopment };
		} );
}

/**
 * Fetches available WordPress versions from the WordPress.org API.
 * Returns a list with "latest" as the first option, followed by all available versions.
 */
export async function fetchWordPressVersions(): Promise< WordPressVersion[] > {
	const [ stableData, developmentData ] = await Promise.all( [
		fetchApiData( 'beta', MINIMUM_WORDPRESS_VERSION ),
		fetchApiData( 'development' ),
	] );

	const shortNameCounts = new Map< string, number >();

	const stableOffers = processOffers( stableData.offers, false, shortNameCounts );
	const devOffer = processOffers( developmentData.offers, true, shortNameCounts )[ 0 ];
	const allOffers = devOffer ? [ devOffer, ...stableOffers ] : stableOffers;

	const latestStable = allOffers.find(
		( o ) => ! isWordPressBetaVersion( o.version ) && ! isWordPressDevVersion( o.version )
	);

	const versions: WordPressVersion[] = [];

	// Add "latest" as first option (maps to the latest stable)
	if ( latestStable ) {
		versions.push( {
			label: generateVersionLabel(
				latestStable.version,
				latestStable.shortName,
				shortNameCounts.get( latestStable.shortName ) || 0
			),
			value: 'latest',
			isBeta: false,
			isDevelopment: false,
		} );
	}

	for ( const offer of allOffers ) {
		versions.push( {
			label: generateVersionLabel(
				offer.version,
				offer.shortName,
				shortNameCounts.get( offer.shortName ) || 0
			),
			value: offer.version,
			isBeta: isWordPressBetaVersion( offer.version ),
			isDevelopment: isWordPressDevVersion( offer.version ),
		} );
	}

	return versions;
}

/**
 * Version `latest` resolves to right now, e.g. `7.1` — what a new site gets
 * installed. Undefined when the version list couldn't be fetched.
 */
export function getLatestVersionLabel( versions: WordPressVersion[] = [] ): string | undefined {
	return versions.find( ( version ) => version.value === DEFAULT_WORDPRESS_VERSION )?.label;
}
