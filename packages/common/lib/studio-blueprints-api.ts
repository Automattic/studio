import { z } from 'zod';

const DEFAULT_BLUEPRINTS_API_URL =
	'https://public-api.wordpress.com/wpcom/v2/studio-app/blueprints';

// Proof of concept: read the catalog from somewhere else, such as a wordpress.studio build of the
// `blueprints/` folder of this repository (`<site>/blueprints/index.json`). See blueprints/README.md.
function getBlueprintsApiUrl(): string {
	const override =
		typeof process !== 'undefined' ? process.env?.STUDIO_BLUEPRINTS_CATALOG_URL : undefined;
	return override || DEFAULT_BLUEPRINTS_API_URL;
}

export const blueprintSchema = z.object( {
	slug: z.string(),
	title: z.string(),
	excerpt: z.string(),
	image: z.string(),
	playground_url: z.string(),
	blueprint: z.record( z.string(), z.unknown() ),
	bundle_url: z.string().nullable().optional(),
	filePath: z.string().optional(),
} );

export type Blueprint = z.infer< typeof blueprintSchema >;

export async function fetchStudioBlueprints( locale?: string ): Promise< Blueprint[] > {
	const apiUrl = new URL( getBlueprintsApiUrl() );
	if ( locale ) {
		apiUrl.searchParams.set( 'locale', locale );
	}
	const url = apiUrl.toString();

	const response = await fetch( url );

	if ( ! response.ok ) {
		throw new Error( `Failed to fetch blueprints: HTTP ${ response.status }` );
	}

	const data: unknown = await response.json();

	if ( ! data || typeof data !== 'object' ) {
		throw new Error( 'Invalid response format' );
	}

	const responseObj = data as Record< string, unknown >;
	const blueprints = responseObj.blueprints;

	if ( ! Array.isArray( blueprints ) ) {
		throw new Error( 'Invalid blueprints array in response' );
	}

	const validBlueprints: Blueprint[] = [];

	for ( const blueprint of blueprints ) {
		const result = blueprintSchema.safeParse( blueprint );
		if ( result.success ) {
			validBlueprints.push( result.data );
		}
	}

	return validBlueprints;
}
