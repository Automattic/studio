import type { Blueprint } from './studio-blueprints-api';

export const BLUEPRINT_USE_CASES = [
	'business',
	'blog',
	'portfolio',
	'store',
	'events',
	'development',
] as const;

export type BlueprintUseCase = ( typeof BLUEPRINT_USE_CASES )[ number ];

// Only some Blueprints have a hosted demo. Keyed by registry slug.
const DEMO_URLS: Record< string, string > = {
	'university-website-2': 'https://kentwooddemo.wordpress.com/',
	'skincare-blog-2': 'https://goodskindemo.wordpress.com/',
	'photography-portfolio': 'https://grammerthemedemo.wordpress.com/',
	'personal-resume-2': 'https://readymadedemo.wordpress.com/',
	substrata: 'https://substratademo.wordpress.com/',
	'non-profit-organization-2': 'https://koinoniathemedemo.wordpress.com/',
	'gaming-news-2': 'https://spieldemo.wordpress.com/',
};

function getBlueprintCategories( blueprint: Pick< Blueprint, 'blueprint' > ): string[] {
	const meta = blueprint.blueprint.meta as { categories?: unknown } | null | undefined;
	if ( ! Array.isArray( meta?.categories ) ) {
		return [];
	}
	return meta.categories.filter( ( category ): category is string => typeof category === 'string' );
}

// Use cases come from the categories each Blueprint has in the registry
// (`meta.categories`). Matching ignores case and accepts the singular, so the
// registry's "Event" category maps to `events`.
export function getBlueprintUseCases(
	blueprint: Pick< Blueprint, 'blueprint' >
): BlueprintUseCase[] {
	const categories = new Set(
		getBlueprintCategories( blueprint ).map( ( category ) => category.trim().toLowerCase() )
	);
	return BLUEPRINT_USE_CASES.filter(
		( useCase ) => categories.has( useCase ) || categories.has( useCase.replace( /s$/, '' ) )
	);
}

export function getBlueprintPreviewUrl(
	blueprint: Pick< Blueprint, 'slug' | 'playground_url' >
): string {
	return DEMO_URLS[ blueprint.slug ] ?? blueprint.playground_url;
}
