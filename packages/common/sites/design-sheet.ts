/**
 * A design-system sheet read from theme.json: the palette, type and button a
 * theme sets, picked into the roles the sheet shows. Both a look's theme.json
 * and a site's resolved global settings and styles read through it.
 */
export type Style = Record< string, unknown >;
type Tokens = Record< string, unknown >;

export interface DesignTokens {
	colors?: Tokens;
	typography?: Record< string, Style >;
	rounded?: Tokens;
	spacing?: Tokens;
	components?: Record< string, Style >;
}

/** The first family of a CSS font-family list, unquoted. */
export function fontFamilyName( value: unknown ): string {
	return String( value ?? '' )
		.split( ',' )[ 0 ]
		.trim()
		.replace( /^["']|["']$/g, '' );
}

export function typographyStyles( tokens: DesignTokens ): Array< [ string, Style ] > {
	return Object.entries( tokens.typography ?? {} ).filter(
		( entry ): entry is [ string, Style ] => typeof entry[ 1 ] === 'object' && entry[ 1 ] !== null
	);
}

function fontFamilies( styles: Style[] ) {
	const families = new Map< string, { fallback: string; weights: Set< string > } >();
	for ( const style of styles ) {
		const [ first = '', ...rest ] = String( style.fontFamily ?? '' ).split( ',' );
		const family = fontFamilyName( first );
		if ( family ) {
			const entry = families.get( family ) ?? {
				fallback: rest.join( ',' ).trim() || 'sans-serif',
				weights: new Set< string >(),
			};
			entry.weights.add( String( style.fontWeight ?? 400 ) );
			families.set( family, entry );
		}
	}
	return families;
}

/** A Google Fonts stylesheet URL covering every family and weight the styles use. */
export function googleFontsUrl(
	styles: Style[],
	display: 'swap' | 'block' = 'swap'
): string | undefined {
	const query = [ ...fontFamilies( styles ) ]
		.map(
			( [ family, { weights } ] ) =>
				`family=${ family.replace( / /g, '+' ) }:wght@${ [ ...weights ]
					.sort( ( a, b ) => Number( a ) - Number( b ) )
					.join( ';' ) }`
		)
		.join( '&' );
	return query ? `https://fonts.googleapis.com/css2?${ query }&display=${ display }` : undefined;
}

function luminance( color: string ): number {
	const hex = color.trim().match( /^#([0-9a-f]{6}|[0-9a-f]{3})/i )?.[ 1 ];
	if ( ! hex ) {
		return 0.5;
	}
	const full = hex.length === 3 ? [ ...hex ].map( ( digit ) => digit + digit ).join( '' ) : hex;
	const [ r, g, b ] = [ 0, 2, 4 ].map( ( start ) => {
		const channel = parseInt( full.slice( start, start + 2 ), 16 ) / 255;
		return channel <= 0.04045 ? channel / 12.92 : ( ( channel + 0.055 ) / 1.055 ) ** 2.4;
	} );
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface DesignSheet {
	colors: Array< [ string, string ] >;
	/** primary, background and text first, then every other color once. */
	palette: Array< [ string, string ] >;
	background: string;
	text: string;
	primary: string;
	accent: string;
	/** The text or background color, whichever reads better on the surface. */
	ink: ( surface: string ) => string;
	styles: Array< [ string, Style ] >;
	display: Style;
	headline: Style;
	body: Style;
	label: Style;
	button: {
		backgroundColor: string;
		textColor: string;
		rounded: unknown;
		padding: unknown;
		typography: Style;
	};
}

/**
 * The roles a design-system sheet shows, picked from the tokens: the page colors,
 * the display/headline/body/label styles and the primary button.
 * Throws when the tokens carry fewer than two colors or no typography style.
 */
export function designSheet( tokens: DesignTokens ): DesignSheet {
	const colors = Object.entries( tokens.colors ?? {} ).filter(
		( entry ): entry is [ string, string ] => typeof entry[ 1 ] === 'string'
	);
	const styles = typographyStyles( tokens );
	if ( colors.length < 2 || ! styles.length ) {
		throw new Error( 'The design needs at least two colors and one typography style.' );
	}

	const named = ( key: string ) => colors.find( ( [ name ] ) => name === key )?.[ 1 ];
	const byLuminance = colors
		.map( ( [ , value ] ) => value )
		.sort( ( a, b ) => luminance( a ) - luminance( b ) );
	const background = named( 'background' ) ?? byLuminance[ byLuminance.length - 1 ];
	const text =
		named( 'text' ) ??
		( luminance( background ) > 0.2 ? byLuminance[ 0 ] : byLuminance[ byLuminance.length - 1 ] );
	const primary = named( 'primary' ) ?? colors[ 0 ][ 1 ];
	const ink = ( surface: string ) =>
		Math.abs( luminance( text ) - luminance( surface ) ) >=
		Math.abs( luminance( background ) - luminance( surface ) )
			? text
			: background;
	const seen = new Set< string >();
	const palette = (
		[ [ 'primary', primary ], [ 'background', background ], [ 'text', text ], ...colors ] as Array<
			[ string, string ]
		>
	 ).filter(
		( [ , value ] ) => ! seen.has( value.toLowerCase() ) && seen.add( value.toLowerCase() )
	);

	const styleNamed = ( name: string ) => styles.find( ( [ key ] ) => key.includes( name ) )?.[ 1 ];
	const display = styleNamed( 'display' ) ?? styles[ 0 ][ 1 ];
	const body = styleNamed( 'body' ) ?? styles[ styles.length - 1 ][ 1 ];
	const label = styleNamed( 'label' ) ?? body;

	const resolve = ( value: unknown ): unknown => {
		const reference = typeof value === 'string' ? value.match( /^\{([^}]+)\}$/ )?.[ 1 ] : undefined;
		return reference
			? reference
					.split( '.' )
					.reduce< unknown >( ( node, key ) => ( node as Style | undefined )?.[ key ], tokens )
			: value;
	};
	const button = tokens.components?.[ 'button-primary' ] ?? {};
	const buttonBackground = String( resolve( button.backgroundColor ) ?? primary );
	const buttonType = resolve( button.typography );

	return {
		colors,
		palette,
		background,
		text,
		primary,
		accent: palette[ 3 ]?.[ 1 ] ?? text,
		ink,
		styles,
		display,
		headline: styleNamed( 'headline' ) ?? display,
		body,
		label,
		button: {
			backgroundColor: buttonBackground,
			textColor: String( resolve( button.textColor ) ?? ink( buttonBackground ) ),
			rounded: resolve( button.rounded ) ?? 0,
			padding: resolve( button.padding ) ?? '14px 28px',
			typography: buttonType && typeof buttonType === 'object' ? ( buttonType as Style ) : label,
		},
	};
}

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
export function presetList( value: unknown ): Preset[] {
	if ( Array.isArray( value ) || ! value || typeof value !== 'object' ) {
		return ( value ?? [] ) as Preset[];
	}
	const origins = value as Record< string, Preset[] | undefined >;
	const bySlug = new Map< string, Preset >();
	for ( const preset of [ ...( origins.theme ?? [] ), ...( origins.custom ?? [] ) ] ) {
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
	const presets = ( group: string, list: string ) =>
		presetList( at( themeJson, 'settings', group, list ) );
	const lists: Record< string, [ Preset[], string ] > = {
		color: [ presets( 'color', 'palette' ), 'color' ],
		'font-family': [ presets( 'typography', 'fontFamilies' ), 'fontFamily' ],
		'font-size': [ presets( 'typography', 'fontSizes' ), 'size' ],
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
	const palette = lists.color[ 0 ].filter( ( preset ) => /^#[0-9a-f]{3,8}$/i.test( preset.color ) );
	const lead = palette.find( ( preset ) => preset.color !== background && preset.color !== text )
		?.color;
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
