import apiFetch from '@wordpress/api-fetch';
import { store as coreDataStore } from '@wordpress/core-data';
import type { WidgetResolverContext } from '@/ui-desks/widgets/types';

export interface ThemePaletteEntry {
	slug: string;
	name?: string;
	color: string;
}

export interface ThemeGlobalStyles {
	palette: ThemePaletteEntry[];
	fontFamily: string;
	textColor: string;
	backgroundColor: string;
}

export interface ActiveTheme {
	slug: string;
	name: string;
	description: string;
	screenshot: string;
	isBlockTheme: boolean;
}

export interface ThemeTemplate {
	id: string;
	slug: string;
	title: string;
	description: string;
	theme: string;
	source: 'theme' | 'custom' | 'plugin';
}

export interface ThemePattern {
	source: 'theme' | 'reusable' | 'template-part';
	id: string;
	title: string;
	content: string;
	categories: string[];
	viewportWidth?: number;
	blockId?: number;
	area?: string;
}

export interface ThemeMaterials {
	theme: ActiveTheme | null;
	styles: ThemeGlobalStyles | null;
	templates: ThemeTemplate[];
	patterns: ThemePattern[];
}

type FontFamilyRaw = { slug?: string; name?: string; fontFamily?: string };
type ByOrigin< T > = T[] | Record< string, T[] | undefined >;

interface WpActiveTheme {
	stylesheet?: string;
	name?: { rendered?: string; raw?: string } | string;
	description?: { rendered?: string; raw?: string } | string;
	screenshot?: string;
	is_block_theme?: boolean;
	isBlockTheme?: boolean;
	_links?: Record< string, Array< { href?: string } > | undefined >;
}

export interface CoreDataThemeSelectors {
	getCurrentTheme: () => WpActiveTheme | null | undefined;
	hasFinishedResolution?: ( selectorName: string, args: unknown[] ) => boolean;
}

interface CoreDataThemeResolvers {
	getCurrentTheme: () => Promise< WpActiveTheme | null | undefined >;
	getEntityRecord: < T >(
		kind: string,
		name: string,
		key?: string | number,
		query?: Record< string, unknown >
	) => Promise< T | undefined >;
	getEntityRecords: < T >(
		kind: string,
		name: string,
		query?: Record< string, unknown >
	) => Promise< T[] | undefined >;
	__experimentalGetCurrentGlobalStylesId?: () => Promise< string | number | null | undefined >;
	__experimentalGetCurrentThemeBaseGlobalStyles?: () => Promise<
		WpGlobalStyles | null | undefined
	>;
	getBlockPatterns?: () => Promise< WpBlockPattern[] | undefined >;
}

interface WpGlobalStyles {
	settings?: {
		color?: { palette?: ByOrigin< ThemePaletteEntry > };
		typography?: { fontFamilies?: ByOrigin< FontFamilyRaw > };
	};
	styles?: {
		color?: { text?: string; background?: string };
		elements?: { h1?: { typography?: { fontFamily?: string } } };
	};
}

interface WpTemplate {
	id: string;
	slug?: string;
	theme?: string;
	title?: { rendered?: string };
	description?: string;
	source?: string;
}

interface WpTemplatePart {
	id: string;
	slug?: string;
	title?: { rendered?: string };
	content?: { raw?: string };
	area?: string;
}

interface WpReusableBlock {
	id: number;
	title?: { raw?: string; rendered?: string };
	content?: { raw?: string; rendered?: string };
}

interface WpBlockPattern {
	name: string;
	title: string;
	content: string;
	categories?: string[];
	viewportWidth?: number;
}

const THEME_TEMPLATE_QUERY = {
	per_page: 100,
	context: 'edit',
} as const;
const REUSABLE_BLOCK_QUERY = {
	per_page: 100,
	context: 'edit',
} as const;
const TEMPLATE_PART_QUERY = {
	per_page: 100,
	context: 'edit',
} as const;

export function selectActiveTheme(
	selectors: CoreDataThemeSelectors
): ActiveTheme | null | undefined {
	const raw = selectors.getCurrentTheme();
	if ( raw ) {
		return normalizeActiveTheme( raw );
	}

	return selectors.hasFinishedResolution?.( 'getCurrentTheme', [] ) ? null : undefined;
}

export async function getActiveTheme(
	context: WidgetResolverContext
): Promise< ActiveTheme | null > {
	try {
		const raw = await getCoreDataResolvers( context ).getCurrentTheme();
		return raw ? normalizeActiveTheme( raw ) : null;
	} catch ( error ) {
		console.warn( 'Failed to load active theme.', error );
		return null;
	}
}

export async function getThemeMaterials(
	context: WidgetResolverContext
): Promise< ThemeMaterials > {
	const rawTheme = await getRawActiveTheme( context );
	const theme = rawTheme ? normalizeActiveTheme( rawTheme ) : null;
	const [ styles, templates, patterns ] = await Promise.all( [
		rawTheme ? getGlobalStylesForTheme( context ) : null,
		getTemplates( context ),
		getPatterns( context ),
	] );

	return {
		theme,
		styles,
		templates,
		patterns,
	};
}

export async function renderPattern( content: string ): Promise< string | null > {
	if ( ! content ) {
		return null;
	}

	try {
		const response = await apiFetch< { html?: string } >( {
			path: '/studio-desk/v1/render-pattern',
			method: 'POST',
			data: { content },
		} );
		return response.html ?? null;
	} catch {
		return null;
	}
}

function getCoreDataResolvers( { registry }: WidgetResolverContext ): CoreDataThemeResolvers {
	return registry.resolveSelect( coreDataStore ) as unknown as CoreDataThemeResolvers;
}

async function getRawActiveTheme(
	context: WidgetResolverContext
): Promise< WpActiveTheme | null > {
	try {
		return ( await getCoreDataResolvers( context ).getCurrentTheme() ) ?? null;
	} catch ( error ) {
		console.warn( 'Failed to load active theme.', error );
		return null;
	}
}

function normalizeActiveTheme( theme: WpActiveTheme ): ActiveTheme {
	return {
		slug: theme.stylesheet ?? '',
		name: readRenderedText( theme.name ) || '(untitled)',
		description: readRenderedText( theme.description ),
		screenshot: theme.screenshot ?? '',
		isBlockTheme: Boolean( theme.is_block_theme ?? theme.isBlockTheme ),
	};
}

async function getGlobalStylesForTheme(
	context: WidgetResolverContext
): Promise< ThemeGlobalStyles | null > {
	const resolvers = getCoreDataResolvers( context );
	const [ base, user ] = await Promise.all( [
		resolvers.__experimentalGetCurrentThemeBaseGlobalStyles?.() ?? Promise.resolve( null ),
		getUserGlobalStyles( resolvers ),
	] );

	const basePalette = flattenByOrigin( base?.settings?.color?.palette, [ 'default' ] );
	const userPalette = flattenByOrigin( user?.settings?.color?.palette, [ 'default' ] );
	const bySlug = new Map< string, ThemePaletteEntry >();
	const extras: ThemePaletteEntry[] = [];
	for ( const paletteEntry of [ ...basePalette, ...userPalette ] ) {
		if ( typeof paletteEntry.color !== 'string' ) {
			continue;
		}
		if ( typeof paletteEntry.slug === 'string' ) {
			bySlug.set( paletteEntry.slug, paletteEntry );
		} else {
			extras.push( paletteEntry );
		}
	}
	const palette = [ ...bySlug.values(), ...extras ];

	const baseFonts = flattenByOrigin( base?.settings?.typography?.fontFamilies );
	const userFonts = flattenByOrigin( user?.settings?.typography?.fontFamilies );
	const fonts = [ ...userFonts, ...baseFonts ];
	const fontFamily =
		resolveFontToken(
			user?.styles?.elements?.h1?.typography?.fontFamily ??
				base?.styles?.elements?.h1?.typography?.fontFamily,
			fonts
		) ??
		fonts[ 0 ]?.fontFamily ??
		'system-ui, sans-serif';

	const textColor =
		resolveColorToken( user?.styles?.color?.text, palette ) ??
		resolveColorToken( base?.styles?.color?.text, palette ) ??
		palette.find( ( entry ) => entry.slug === 'foreground' || entry.slug === 'contrast' )?.color ??
		'#111111';
	const backgroundColor =
		resolveColorToken( user?.styles?.color?.background, palette ) ??
		resolveColorToken( base?.styles?.color?.background, palette ) ??
		palette.find( ( entry ) => entry.slug === 'background' || entry.slug === 'base' )?.color ??
		'#ffffff';

	return {
		palette,
		fontFamily,
		textColor,
		backgroundColor,
	};
}

async function getUserGlobalStyles(
	resolvers: CoreDataThemeResolvers
): Promise< WpGlobalStyles | null > {
	const currentStylesId = await resolvers.__experimentalGetCurrentGlobalStylesId?.();
	if ( ! currentStylesId ) {
		return null;
	}

	try {
		return (
			( await resolvers.getEntityRecord< WpGlobalStyles >(
				'root',
				'globalStyles',
				currentStylesId,
				{ context: 'edit' }
			) ) ?? null
		);
	} catch ( error ) {
		console.warn( 'Failed to load global styles.', error );
		return null;
	}
}

async function getTemplates( context: WidgetResolverContext ): Promise< ThemeTemplate[] > {
	try {
		const raw =
			( await getCoreDataResolvers( context ).getEntityRecords< WpTemplate >(
				'postType',
				'wp_template',
				THEME_TEMPLATE_QUERY
			) ) ?? [];

		return raw.map( ( template ) => ( {
			id: template.id,
			slug: template.slug ?? '',
			title: template.title?.rendered ?? template.slug ?? '(untitled)',
			description: template.description ?? '',
			theme: template.theme ?? '',
			source:
				template.source === 'custom' || template.source === 'plugin' ? template.source : 'theme',
		} ) );
	} catch ( error ) {
		console.warn( 'Failed to load theme templates.', error );
		return [];
	}
}

async function getPatterns( context: WidgetResolverContext ): Promise< ThemePattern[] > {
	const resolvers = getCoreDataResolvers( context );
	const [ themeRaw, reusableRaw, templatePartsRaw ] = await Promise.all( [
		getThemePatternsRaw( resolvers ),
		getReusableBlocksRaw( resolvers ),
		getTemplatePartsRaw( resolvers ),
	] );

	const themePatterns: ThemePattern[] = themeRaw.map( ( pattern ) => ( {
		source: 'theme',
		id: pattern.name,
		title: pattern.title,
		content: pattern.content,
		categories: Array.isArray( pattern.categories ) ? pattern.categories : [],
		viewportWidth: typeof pattern.viewportWidth === 'number' ? pattern.viewportWidth : undefined,
	} ) );

	const reusablePatterns: ThemePattern[] = reusableRaw.map( ( block ) => ( {
		source: 'reusable',
		id: String( block.id ),
		title: block.title?.raw ?? block.title?.rendered ?? '(untitled)',
		content: block.content?.raw ?? block.content?.rendered ?? '',
		categories: [],
		blockId: block.id,
	} ) );

	const templateParts: ThemePattern[] = templatePartsRaw.map( ( templatePart ) => ( {
		source: 'template-part',
		id: templatePart.id,
		title: templatePart.title?.rendered ?? templatePart.slug ?? '(untitled)',
		content: templatePart.content?.raw ?? '',
		categories: [],
		area: typeof templatePart.area === 'string' ? templatePart.area : undefined,
	} ) );

	return [ ...themePatterns, ...templateParts, ...reusablePatterns ];
}

async function getThemePatternsRaw(
	resolvers: CoreDataThemeResolvers
): Promise< WpBlockPattern[] > {
	try {
		return ( await resolvers.getBlockPatterns?.() ) ?? [];
	} catch ( error ) {
		console.warn( 'Failed to load theme patterns.', error );
		return [];
	}
}

async function getReusableBlocksRaw(
	resolvers: CoreDataThemeResolvers
): Promise< WpReusableBlock[] > {
	try {
		return (
			( await resolvers.getEntityRecords< WpReusableBlock >(
				'postType',
				'wp_block',
				REUSABLE_BLOCK_QUERY
			) ) ?? []
		);
	} catch ( error ) {
		console.warn( 'Failed to load reusable blocks.', error );
		return [];
	}
}

async function getTemplatePartsRaw(
	resolvers: CoreDataThemeResolvers
): Promise< WpTemplatePart[] > {
	try {
		return (
			( await resolvers.getEntityRecords< WpTemplatePart >(
				'postType',
				'wp_template_part',
				TEMPLATE_PART_QUERY
			) ) ?? []
		);
	} catch ( error ) {
		console.warn( 'Failed to load template parts.', error );
		return [];
	}
}

function readRenderedText( value: WpActiveTheme[ 'name' ] ) {
	if ( typeof value === 'string' ) {
		return value;
	}

	return value?.rendered ?? value?.raw ?? '';
}

function resolveColorToken(
	value: string | undefined,
	palette: ThemePaletteEntry[]
): string | undefined {
	if ( ! value ) {
		return undefined;
	}
	const match = value.match( /var\(--wp--preset--color--([a-z0-9-]+)\)/i );
	if ( ! match ) {
		return value;
	}
	const slug = match[ 1 ];
	return palette.find( ( entry ) => entry.slug === slug )?.color ?? value;
}

function resolveFontToken(
	value: string | undefined,
	fonts: Array< { slug?: string; fontFamily?: string } >
): string | undefined {
	if ( ! value ) {
		return undefined;
	}
	const match = value.match( /var\(--wp--preset--font-family--([a-z0-9-]+)\)/i );
	if ( ! match ) {
		return value;
	}
	const slug = match[ 1 ];
	return fonts.find( ( font ) => font.slug === slug )?.fontFamily ?? value;
}

function flattenByOrigin< T extends { slug?: string } >(
	raw: ByOrigin< T > | undefined,
	excludeOrigins: string[] = []
): T[] {
	if ( ! raw ) {
		return [];
	}
	if ( Array.isArray( raw ) ) {
		return raw.filter( Boolean );
	}

	const byOrigin = raw as Record< string, T[] | undefined >;
	const excluded = new Set( excludeOrigins );
	const orderedOrigins = [ 'theme', 'default', 'custom' ];
	const bySlug = new Map< string, T >();
	const extra: T[] = [];

	for ( const origin of orderedOrigins ) {
		if ( excluded.has( origin ) || ! Array.isArray( byOrigin[ origin ] ) ) {
			continue;
		}
		for ( const entry of byOrigin[ origin ] ?? [] ) {
			if ( ! entry ) {
				continue;
			}
			if ( typeof entry.slug === 'string' ) {
				bySlug.set( entry.slug, entry );
			} else {
				extra.push( entry );
			}
		}
	}

	for ( const [ origin, entries ] of Object.entries( byOrigin ) ) {
		if (
			orderedOrigins.includes( origin ) ||
			excluded.has( origin ) ||
			! Array.isArray( entries )
		) {
			continue;
		}
		for ( const entry of entries ) {
			if ( ! entry ) {
				continue;
			}
			if ( typeof entry.slug === 'string' ) {
				bySlug.set( entry.slug, entry );
			} else {
				extra.push( entry );
			}
		}
	}

	return [ ...bySlug.values(), ...extra ];
}
