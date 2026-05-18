import type { ThemeTemplate } from '@/ui-desks/widgets/theme/api';

const EXACT_FALLBACKS: Record< string, string > = {
	single: 'singular',
	page: 'singular',
	attachment: 'single',
	singular: 'index',
	archive: 'index',
	category: 'archive',
	tag: 'archive',
	taxonomy: 'archive',
	author: 'archive',
	date: 'archive',
	home: 'index',
	'front-page': 'home',
	'404': 'index',
	search: 'index',
	embed: 'index',
};

export interface ThemeTemplatePlacement {
	template: ThemeTemplate;
	col: number;
	row: number;
}

export interface ThemeTemplateEdge {
	fromSlug: string;
	toSlug: string;
}

export function getTemplateParent( slug: string ): string | null {
	if ( slug === 'index' ) {
		return null;
	}
	if ( EXACT_FALLBACKS[ slug ] ) {
		return EXACT_FALLBACKS[ slug ];
	}

	if ( slug.startsWith( 'single-' ) ) {
		return 'single';
	}
	if ( slug.startsWith( 'page-' ) ) {
		return 'page';
	}
	if ( slug.startsWith( 'archive-' ) ) {
		return 'archive';
	}
	if ( slug.startsWith( 'category-' ) ) {
		return 'category';
	}
	if ( slug.startsWith( 'tag-' ) ) {
		return 'tag';
	}
	if ( slug.startsWith( 'author-' ) ) {
		return 'author';
	}
	if ( slug.startsWith( 'taxonomy-' ) ) {
		return 'taxonomy';
	}
	if ( slug.startsWith( 'date-' ) ) {
		return 'date';
	}
	if ( slug.startsWith( 'embed-' ) ) {
		return 'embed';
	}

	return 'index';
}

export function buildTemplateGraph( templates: ThemeTemplate[] ): {
	placements: ThemeTemplatePlacement[];
	edges: ThemeTemplateEdge[];
	maxCol: number;
	maxRowsPerCol: Map< number, number >;
} {
	const present = new Set( templates.map( ( template ) => template.slug ) );
	const depthBySlug = new Map< string, number >();

	function computeDepth( slug: string ): number {
		const cached = depthBySlug.get( slug );
		if ( cached !== undefined ) {
			return cached;
		}

		const parent = getRealParent( slug, present );
		const depth = parent === null ? 0 : computeDepth( parent ) + 1;
		depthBySlug.set( slug, depth );
		return depth;
	}

	for ( const template of templates ) {
		computeDepth( template.slug );
	}

	const maxDepth = Math.max( 0, ...depthBySlug.values() );
	const byCol = new Map< number, ThemeTemplate[] >();
	for ( const template of templates ) {
		const depth = depthBySlug.get( template.slug ) ?? 0;
		const col = maxDepth - depth;
		byCol.set( col, [ ...( byCol.get( col ) ?? [] ), template ] );
	}
	for ( const group of byCol.values() ) {
		group.sort( ( first, second ) => first.slug.localeCompare( second.slug ) );
	}

	const placements: ThemeTemplatePlacement[] = [];
	const maxRowsPerCol = new Map< number, number >();
	for ( const [ col, group ] of [ ...byCol.entries() ].sort(
		( [ firstCol ], [ secondCol ] ) => firstCol - secondCol
	) ) {
		maxRowsPerCol.set( col, group.length );
		group.forEach( ( template, row ) => placements.push( { template, col, row } ) );
	}

	const edges: ThemeTemplateEdge[] = [];
	for ( const template of templates ) {
		const parent = getRealParent( template.slug, present );
		if ( parent && present.has( parent ) ) {
			edges.push( { fromSlug: template.slug, toSlug: parent } );
		}
	}

	return { placements, edges, maxCol: maxDepth, maxRowsPerCol };
}

function getRealParent( slug: string, present: Set< string > ): string | null {
	let current = getTemplateParent( slug );
	while ( current && ! present.has( current ) ) {
		current = getTemplateParent( current );
	}
	return current;
}
