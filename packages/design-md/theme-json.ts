import type { DesignTokens, Style } from './index';

type Tree = Record< string, unknown >;
type Preset = Record< string, string >;

const at = ( tree: unknown, ...keys: string[] ): unknown =>
	keys.reduce< unknown >( ( node, key ) => ( node as Tree | undefined )?.[ key ], tree );

const typography = ( tree: unknown, ...keys: string[] ) =>
	( at( tree, ...keys, 'typography' ) ?? {} ) as Tree;

// A theme.json padding object as CSS shorthand.
const padding = ( value: unknown ) =>
	value && typeof value === 'object'
		? [ 'top', 'right', 'bottom', 'left' ]
				.map( ( side ) => ( value as Tree )[ side ] ?? 0 )
				.join( ' ' )
		: value;

/**
 * A theme.json preset list. A theme's own file lists presets; WordPress's
 * resolved settings (wp_get_global_settings()) key them by origin, and the
 * editor offers the theme's and the user's, or core's when there are none.
 */
function presetList( value: unknown, includeDefaults = false ): Preset[] {
	if ( Array.isArray( value ) || ! value || typeof value !== 'object' ) {
		return ( value ?? [] ) as Preset[];
	}
	const origins = value as Record< string, Preset[] | undefined >;
	const bySlug = new Map< string, Preset >();
	for ( const preset of [
		...( includeDefaults ? origins.default ?? [] : [] ),
		...( origins.theme ?? [] ),
		...( origins.custom ?? [] ),
	] ) {
		bySlug.set( preset.slug, preset );
	}
	return bySlug.size ? [ ...bySlug.values() ] : origins.default ?? [];
}

/**
 * Reads a theme.json as the design tokens the sheet shows: its palette led by
 * the background, text and button colors, the type of its headings, body and
 * buttons, its button and its spacing sizes.
 */
export function themeJsonDesign( themeJson: Tree ): DesignTokens {
	const presets = ( group: string, list: string, includeDefaults = false ) =>
		presetList( at( themeJson, 'settings', group, list ), includeDefaults );
	const lists: Record< string, [ Preset[], string ] > = {
		color: [ presets( 'color', 'palette', true ), 'color' ],
		'font-family': [ presets( 'typography', 'fontFamilies', true ), 'fontFamily' ],
		'font-size': [ presets( 'typography', 'fontSizes', true ), 'size' ],
	};
	// A preset reference, either way theme.json writes one, as its value.
	const value = ( raw: unknown ) => {
		const match = String( raw ?? '' ).match(
			/^var(?::preset\|([\w-]+)\|([\w-]+)|\(--wp--preset--([a-z-]+?)--([\w-]+)\))$/
		);
		if ( ! match ) {
			return raw;
		}
		const [ list, field ] = lists[ match[ 1 ] ?? match[ 3 ] ] ?? [ [], '' ];
		const slug = match[ 2 ] ?? match[ 4 ];
		return list.find( ( preset ) => preset.slug === slug )?.[ field ] ?? raw;
	};
	const style = ( tree: Tree ): Style =>
		Object.fromEntries(
			[ 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing' ]
				.filter( ( key ) => tree[ key ] !== undefined )
				.map( ( key ) => [ key, value( tree[ key ] ) ] )
		) as Style;
	const spacing = presets( 'spacing', 'spacingSizes' );
	const styles = themeJson.styles;
	const body = style( typography( styles ) );
	const heading = { ...body, ...style( typography( styles, 'elements', 'heading' ) ) };
	const button = at( styles, 'elements', 'button' );
	const background = value( at( styles, 'color', 'background' ) );
	const text = value( at( styles, 'color', 'text' ) );
	const buttonBackground = value( at( button, 'color', 'background' ) );
	const palette = presets( 'color', 'palette' ).filter( ( preset ) =>
		/^#[0-9a-f]{3,8}$/i.test( preset.color )
	);
	const lead =
		[ 'primary', 'accent', 'accent-1' ]
			.map( ( slug ) => palette.find( ( preset ) => preset.slug === slug )?.color )
			.find( Boolean ) ??
		palette.find(
			( preset ) =>
				preset.color !== background &&
				preset.color !== text &&
				! [ 'base', 'contrast', 'background', 'text' ].includes( preset.slug )
		)?.color;
	const radius = value( at( button, 'border', 'radius' ) );
	return {
		colors: Object.fromEntries(
			[
				[ 'primary', lead ],
				[ 'background', background ],
				[ 'text', text ],
				...palette.map( ( preset ) => [ preset.slug, preset.color ] ),
			].filter( ( [ , color ] ) => typeof color === 'string' && color.startsWith( '#' ) )
		),
		typography: {
			display: { ...heading, ...style( typography( styles, 'elements', 'h1' ) ) },
			headline: { ...heading, ...style( typography( styles, 'elements', 'h2' ) ) },
			body,
			label: { ...body, ...style( typography( button ) ) },
		},
		rounded: radius === undefined ? {} : { sm: radius, md: radius },
		spacing: Object.fromEntries( spacing.map( ( preset ) => [ preset.slug, preset.size ] ) ),
		components: {
			'button-primary': {
				...( typeof buttonBackground === 'string' && { backgroundColor: buttonBackground } ),
				...( at( button, 'color', 'text' ) !== undefined && {
					textColor: value( at( button, 'color', 'text' ) ),
				} ),
				...( radius !== undefined && { rounded: radius } ),
				...( at( button, 'spacing', 'padding' ) !== undefined && {
					padding: padding( at( button, 'spacing', 'padding' ) ),
				} ),
			},
		},
	} as DesignTokens;
}
