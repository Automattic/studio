/**
 * Display curation for the public blueprints gallery, shared by the desktop
 * renderer's Add Site flow and the apps/ui onboarding flow so the two can't
 * drift. The wpcom blueprints endpoint returns raw titles/excerpts; these
 * helpers rename the featured trio for display, override their excerpts,
 * and pin their order.
 */

type TranslateFn = ( text: string ) => string;

export const FEATURED_BLUEPRINT_SLUGS: ReadonlySet< string > = new Set( [
	'woo-shop',
	'development',
	'quick-start',
] );

const BLUEPRINT_DISPLAY_NAMES: Record< string, string > = {
	'Quick Start': 'WordPress.com',
	Development: 'WordPress Dev',
	Commerce: 'WooCommerce',
};

const BLUEPRINT_ORDER: Record< string, number > = {
	'Quick Start': 1,
	Commerce: 2,
	Development: 3,
};

// Takes the translate function as a parameter (rather than importing the
// global `__`) so callers using a scoped i18n instance — like the desktop
// renderer's I18nProvider — still get translated strings.
function getBlueprintExcerptOverrides( __: TranslateFn ): Record< string, string > {
	return {
		'Quick Start': __(
			'A WordPress.com-like environment with Business plan plugins and themes pre-installed.'
		),
		Commerce: __(
			'Create your next online store with WooCommerce and its companion plugins pre-installed.'
		),
		Development: __( 'A streamlined environment for building and testing themes or plugins.' ),
	};
}

export function curateBlueprintsForDisplay< T extends { title: string; excerpt: string } >(
	blueprints: T[],
	__: TranslateFn
): T[] {
	const excerptOverrides = getBlueprintExcerptOverrides( __ );
	return [ ...blueprints ]
		.sort( ( a, b ) => ( BLUEPRINT_ORDER[ a.title ] ?? 99 ) - ( BLUEPRINT_ORDER[ b.title ] ?? 99 ) )
		.map( ( item ) => ( {
			...item,
			excerpt: excerptOverrides[ item.title ] || item.excerpt,
			title: BLUEPRINT_DISPLAY_NAMES[ item.title ] || item.title,
		} ) );
}
