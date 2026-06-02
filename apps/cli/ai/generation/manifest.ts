import { extractJson } from './llm';
import { deriveSlug, isValidSlug } from './paths';

/**
 * The file manifest the `manifest` generator produces from a site spec. It
 * drives the whole pipeline: which theme files to generate, whether a
 * companion plugin is needed, and what content to seed.
 */

export type LayoutMode =
	| 'vertical-stack'
	| 'sidebar-left'
	| 'sidebar-right'
	| 'dual-sidebar'
	| 'landing-page'
	| 'magazine-grid'
	| 'canvas-floating-chrome';

export type ContentMode = 'homepage-and-pages' | 'blog-first' | 'index-only';

export interface PagePlan {
	slug: string;
	title: string;
	brief: string;
}

export interface PostTypeField {
	key: string;
	type: 'string' | 'number' | 'boolean';
}

export interface PostTypePlan {
	slug: string;
	name: string;
	fields: PostTypeField[];
}

export interface RestRoutePlan {
	path: string;
	purpose: string;
}

export interface BlockPlan {
	slug: string;
	title: string;
	purpose: string;
}

export interface CompanionPluginPlan {
	needed: boolean;
	slug: string;
	name: string;
	postTypes: PostTypePlan[];
	restRoutes: RestRoutePlan[];
	blocks: BlockPlan[];
}

export interface SeedItem {
	type: string;
	slug: string;
	title: string;
}

export interface SiteManifest {
	themeSlug: string;
	themeName: string;
	layoutMode: LayoutMode;
	contentMode: ContentMode;
	parts: string[];
	templates: string[];
	pages: PagePlan[];
	patterns: string[];
	companionPlugin: CompanionPluginPlan;
	seed: SeedItem[];
}

const LAYOUT_MODES: LayoutMode[] = [
	'vertical-stack',
	'sidebar-left',
	'sidebar-right',
	'dual-sidebar',
	'landing-page',
	'magazine-grid',
	'canvas-floating-chrome',
];

const CONTENT_MODES: ContentMode[] = [ 'homepage-and-pages', 'blog-first', 'index-only' ];

function asString( value: unknown, fallback = '' ): string {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asStringArray( value: unknown ): string[] {
	if ( ! Array.isArray( value ) ) {
		return [];
	}
	return value
		.filter( ( v ): v is string => typeof v === 'string' && v.trim().length > 0 )
		.map( ( v ) => v.trim() );
}

function normalizeSlug( value: unknown, fallback: string ): string {
	const candidate = deriveSlug( asString( value, fallback ) );
	return candidate && isValidSlug( candidate ) ? candidate : fallback;
}

function normalizePages( value: unknown ): PagePlan[] {
	if ( ! Array.isArray( value ) ) {
		return [];
	}
	const pages: PagePlan[] = [];
	for ( const raw of value ) {
		if ( ! raw || typeof raw !== 'object' ) {
			continue;
		}
		const obj = raw as Record< string, unknown >;
		const title = asString( obj.title );
		const slug = normalizeSlug( obj.slug ?? title, deriveSlug( title || 'page' ) || 'page' );
		if ( ! title ) {
			continue;
		}
		pages.push( { slug, title, brief: asString( obj.brief ) } );
	}
	return pages;
}

function normalizeCompanionPlugin( value: unknown, themeSlug: string ): CompanionPluginPlan {
	const obj = ( value && typeof value === 'object' ? value : {} ) as Record< string, unknown >;
	const needed = obj.needed === true;
	const slug = normalizeSlug(
		obj.slug ?? `${ themeSlug }-functionality`,
		`${ themeSlug }-functionality`
	);

	const postTypes: PostTypePlan[] = Array.isArray( obj.postTypes )
		? ( obj.postTypes as unknown[] )
				.filter( ( p ): p is Record< string, unknown > => !! p && typeof p === 'object' )
				.map( ( p ) => ( {
					slug: normalizeSlug( p.slug, deriveSlug( asString( p.name, 'item' ) ) || 'item' ),
					name: asString( p.name, 'Item' ),
					fields: Array.isArray( p.fields )
						? ( p.fields as unknown[] )
								.filter( ( f ): f is Record< string, unknown > => !! f && typeof f === 'object' )
								.map( ( f ) => ( {
									key: asString( f.key, 'field' ),
									type: ( [ 'string', 'number', 'boolean' ].includes( asString( f.type ) )
										? asString( f.type )
										: 'string' ) as PostTypeField[ 'type' ],
								} ) )
						: [],
				} ) )
		: [];

	const restRoutes: RestRoutePlan[] = Array.isArray( obj.restRoutes )
		? ( obj.restRoutes as unknown[] )
				.filter( ( r ): r is Record< string, unknown > => !! r && typeof r === 'object' )
				.map( ( r ) => ( { path: asString( r.path ), purpose: asString( r.purpose ) } ) )
				.filter( ( r ) => r.path )
		: [];

	const blocks: BlockPlan[] = Array.isArray( obj.blocks )
		? ( obj.blocks as unknown[] )
				.filter( ( b ): b is Record< string, unknown > => !! b && typeof b === 'object' )
				.map( ( b ) => ( {
					slug: normalizeSlug( b.slug, deriveSlug( asString( b.title, 'block' ) ) || 'block' ),
					title: asString( b.title, 'Block' ),
					purpose: asString( b.purpose ),
				} ) )
		: [];

	return {
		needed,
		slug,
		name: asString( obj.name, 'Site Functionality' ),
		postTypes,
		restRoutes,
		blocks,
	};
}

function normalizeSeed( value: unknown ): SeedItem[] {
	if ( ! Array.isArray( value ) ) {
		return [];
	}
	return ( value as unknown[] )
		.filter( ( s ): s is Record< string, unknown > => !! s && typeof s === 'object' )
		.map( ( s ) => ( {
			type: asString( s.type, 'page' ),
			slug: normalizeSlug( s.slug ?? s.title, deriveSlug( asString( s.title, 'item' ) ) || 'item' ),
			title: asString( s.title ),
		} ) )
		.filter( ( s ) => s.title );
}

export function parseManifest( raw: string ): SiteManifest {
	let data: Record< string, unknown >;
	try {
		data = JSON.parse( extractJson( raw ) ) as Record< string, unknown >;
	} catch ( error ) {
		throw new Error(
			`The manifest generator did not return valid JSON: ${
				error instanceof Error ? error.message : String( error )
			}`
		);
	}

	const themeName = asString( data.themeName, 'Generated Site' );
	const themeSlug = normalizeSlug(
		data.themeSlug ?? themeName,
		deriveSlug( themeName ) || 'generated-site'
	);

	const layoutMode = (
		LAYOUT_MODES.includes( asString( data.layoutMode ) as LayoutMode )
			? asString( data.layoutMode )
			: 'vertical-stack'
	) as LayoutMode;
	const contentMode = (
		CONTENT_MODES.includes( asString( data.contentMode ) as ContentMode )
			? asString( data.contentMode )
			: 'homepage-and-pages'
	) as ContentMode;

	const parts = asStringArray( data.parts );
	const templates = asStringArray( data.templates );

	return {
		themeSlug,
		themeName,
		layoutMode,
		contentMode,
		parts: parts.length ? parts : [ 'header', 'footer' ],
		templates: templates.length ? templates : [ 'index', 'page' ],
		pages: normalizePages( data.pages ),
		patterns: asStringArray( data.patterns ),
		companionPlugin: normalizeCompanionPlugin( data.companionPlugin, themeSlug ),
		seed: normalizeSeed( data.seed ),
	};
}
