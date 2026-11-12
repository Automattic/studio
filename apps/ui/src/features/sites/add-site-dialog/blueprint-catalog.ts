import type { LibraryBlueprint } from '@studio/blueprints';

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

// Takes any Blueprint-shaped `meta`, since the Library only loosely checks it.
function getBlueprintCategories( { blueprint }: { blueprint: object } ): string[] {
	const meta = ( blueprint as { meta?: { categories?: unknown } | null } ).meta;
	if ( ! Array.isArray( meta?.categories ) ) {
		return [];
	}
	return meta.categories.filter( ( category ): category is string => typeof category === 'string' );
}

// Use cases come from the categories each Blueprint has in the registry
// (`meta.categories`). Matching ignores case and accepts the singular, so the
// registry's "Event" category maps to `events`.
export function getBlueprintUseCases( blueprint: { blueprint: object } ): BlueprintUseCase[] {
	const categories = new Set(
		getBlueprintCategories( blueprint ).map( ( category ) => category.trim().toLowerCase() )
	);
	return BLUEPRINT_USE_CASES.filter(
		( useCase ) => categories.has( useCase ) || categories.has( useCase.replace( /s$/, '' ) )
	);
}

export function getBlueprintPreviewUrl(
	blueprint: Pick< LibraryBlueprint, 'slug' | 'playgroundUrl' >
): string {
	return DEMO_URLS[ blueprint.slug ] ?? blueprint.playgroundUrl;
}
