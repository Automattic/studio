import { z } from 'zod';

const BLUEPRINTS_API_URL = 'https://public-api.wordpress.com/wpcom/v2/studio-app/blueprints';

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
	const url = locale
		? `${ BLUEPRINTS_API_URL }?locale=${ encodeURIComponent( locale ) }`
		: BLUEPRINTS_API_URL;

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
