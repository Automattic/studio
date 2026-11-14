import { z } from 'zod';
import type { Blueprint } from './validate';

const LIBRARY_URL = 'https://public-api.wordpress.com/wpcom/v2/studio-app/blueprints';

const libraryEntrySchema = z.object( {
	slug: z.string(),
	title: z.string(),
	excerpt: z.string(),
	image: z.string(),
	playground_url: z.string(),
	blueprint: z.record( z.string(), z.unknown() ),
	bundle_url: z.string().nullable().optional(),
} );

export interface LibraryBlueprint {
	slug: string;
	title: string;
	excerpt: string;
	image: string;
	playgroundUrl: string;
	// A zip with the Blueprint and the files its steps use, when it has any.
	bundleUrl?: string;
	blueprint: Blueprint;
}

export async function fetchLibraryBlueprints( { locale }: { locale?: string } = {} ): Promise<
	LibraryBlueprint[]
> {
	const url = locale ? `${ LIBRARY_URL }?locale=${ encodeURIComponent( locale ) }` : LIBRARY_URL;
	const response = await fetch( url );
	if ( ! response.ok ) {
		throw new Error( `Failed to fetch the Blueprint Library: HTTP ${ response.status }` );
	}

	const entries = ( ( await response.json() ) as { blueprints?: unknown } | null )?.blueprints;
	if ( ! Array.isArray( entries ) ) {
		throw new Error( 'Invalid Blueprint Library response' );
	}

	return entries.flatMap( ( entry ) => {
		const parsed = libraryEntrySchema.safeParse( entry );
		if ( ! parsed.success ) {
			return [];
		}
		const { playground_url, bundle_url, blueprint, ...rest } = parsed.data;
		return {
			...rest,
			playgroundUrl: playground_url,
			bundleUrl: bundle_url ?? undefined,
			blueprint: blueprint as Blueprint,
		};
	} );
}
