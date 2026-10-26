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

// The registry's categories don't say what each Blueprint is for, and only some
// have a hosted demo. Keyed by registry slug until the catalog ships with Studio.
const CATALOG: Record< string, { useCases: BlueprintUseCase[]; demoUrl?: string } > = {
	'wedding-rsvp': { useCases: [ 'events' ] },
	'stylish-press-2': { useCases: [ 'store' ] },
	'university-website-2': {
		useCases: [ 'business' ],
		demoUrl: 'https://kentwooddemo.wordpress.com/',
	},
	'skincare-blog-2': { useCases: [ 'blog' ], demoUrl: 'https://goodskindemo.wordpress.com/' },
	'photography-portfolio': {
		useCases: [ 'portfolio' ],
		demoUrl: 'https://grammerthemedemo.wordpress.com/',
	},
	'personal-resume-2': {
		useCases: [ 'portfolio' ],
		demoUrl: 'https://readymadedemo.wordpress.com/',
	},
	'personal-blog-2': { useCases: [ 'blog' ], demoUrl: 'https://substratademo.wordpress.com/' },
	'non-profit-organization-2': {
		useCases: [ 'business' ],
		demoUrl: 'https://koinoniathemedemo.wordpress.com/',
	},
	'gaming-news-2': { useCases: [ 'blog' ], demoUrl: 'https://spieldemo.wordpress.com/' },
	'woo-shop': { useCases: [ 'store' ] },
	development: { useCases: [ 'development' ] },
	'quick-start': { useCases: [ 'business' ] },
};

export function getBlueprintUseCases( blueprint: Pick< Blueprint, 'slug' > ): BlueprintUseCase[] {
	return CATALOG[ blueprint.slug ]?.useCases ?? [];
}

export function getBlueprintPreviewUrl(
	blueprint: Pick< Blueprint, 'slug' | 'playground_url' >
): string {
	return CATALOG[ blueprint.slug ]?.demoUrl ?? blueprint.playground_url;
}
