import { parse, parseDocument } from 'yaml';

export type Style = Record< string, unknown >;
type Tokens = Record< string, unknown >;

export interface DesignTokens {
	name?: unknown;
	description?: unknown;
	colors?: Tokens;
	typography?: Record< string, Style >;
	rounded?: Tokens;
	spacing?: Tokens;
	components?: Record< string, Style >;
	imagery?: { filter?: unknown; overlay?: unknown };
}

export interface ThemeJson {
	settings?: Record< string, unknown >;
	styles?: Record< string, unknown >;
	[ key: string ]: unknown;
}

export interface ThemeJsonFromDesign {
	themeJson: ThemeJson;
	fontsUrl?: string;
	summary: string;
}

const SPACING_NAMES: Record< string, string > = {
	xs: 'Extra small',
	sm: 'Small',
	md: 'Medium',
	lg: 'Large',
	xl: 'Extra large',
};

const titleCase = ( key: string ) =>
	key.replace( /[-_]+/g, ' ' ).replace( /\b\w/g, ( char ) => char.toUpperCase() );

const slugify = ( name: string ) =>
	name
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' );

const dimension = ( value: unknown ) =>
	typeof value === 'number' ? `${ value }px` : String( value );

const plural = ( count: number, one: string, many: string ) =>
	`${ count } ${ count === 1 ? one : many }`;

/**
 * Splits the YAML front matter off a DESIGN.md document and parses it.
 * Throws when the document does not open with front matter or never closes it.
 */
export function parseDesignMd( design: string ): DesignTokens {
	const frontMatter = design.trimStart().match( /^---\r?\n([\s\S]*?)\r?\n---/ )?.[ 1 ];
	if ( ! frontMatter ) {
		if ( design.trimStart().startsWith( '---' ) ) {
			throw new Error(
				"The DESIGN.md draft's front matter is never closed — end the YAML block with a second --- line before the prose."
			);
		}
		throw new Error(
			'The DESIGN.md draft must start with YAML front matter, opening with a --- line.'
		);
	}
	return parse( frontMatter ) ?? {};
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

/**
 * Lays the DESIGN.md tokens over a base theme.json: palette, font families and sizes,
 * spacing, radii, and root, heading, link and button styles, each under the DESIGN.md name.
 * `fontFaces` (theme.json fontFace entries keyed by family name) declares the font files
 * each family loads. Returns undefined when the tokens carry no colors.
 */
export function themeJsonFromDesign(
	tokens: DesignTokens,
	themeJson: ThemeJson,
	fontFaces: Record< string, object[] > = {}
): ThemeJsonFromDesign | undefined {
	const colors = Object.entries( tokens.colors ?? {} ).filter(
		( entry ): entry is [ string, string ] => typeof entry[ 1 ] === 'string'
	);
	if ( ! colors.length ) {
		return undefined;
	}

	const styles = typographyStyles( tokens );
	const spacing = Object.entries( tokens.spacing ?? {} );
	const rounded = tokens.rounded ?? {};
	const families = fontFamilies( styles.map( ( [ , style ] ) => style ) );

	const resolve = ( value: unknown ): string =>
		dimension( value ).replace(
			/\{(colors|spacing|rounded)\.([\w-]+)\}/g,
			( match, group: string, key: string ) => {
				if ( group === 'rounded' ) {
					return key in rounded ? dimension( rounded[ key ] ) : match;
				}
				return `var:preset|${ group === 'colors' ? 'color' : 'spacing' }|${ key }`;
			}
		);

	const typography = ( style: Style | undefined, withSize: boolean ) => {
		if ( ! style ) {
			return undefined;
		}
		const family = fontFamilyName( style.fontFamily );
		const sizeSlug = styles.find( ( [ , candidate ] ) => candidate === style )?.[ 0 ];
		return compact( {
			fontFamily: family && `var:preset|font-family|${ slugify( family ) }`,
			fontSize: withSize && style.fontSize !== undefined && `var:preset|font-size|${ sizeSlug }`,
			fontWeight: style.fontWeight !== undefined && String( style.fontWeight ),
			lineHeight: style.lineHeight !== undefined && String( style.lineHeight ),
			letterSpacing: style.letterSpacing !== undefined && dimension( style.letterSpacing ),
			textTransform: style.textTransform !== undefined && String( style.textTransform ),
		} );
	};

	const byName = Object.fromEntries( styles );
	const color = ( key: string ) =>
		tokens.colors?.[ key ] !== undefined && `var:preset|color|${ key }`;
	const button = tokens.components?.[ 'button-primary' ];
	const padding =
		button?.padding !== undefined ? String( button.padding ).trim().split( /\s+/ ) : [];
	const [ top, right = top, bottom = top, left = right ] = padding.map( resolve );

	const settings = themeJson.settings ?? {};
	const result: ThemeJson = {
		...themeJson,
		settings: {
			...settings,
			color: {
				...( settings.color as object ),
				palette: colors.map( ( [ slug, value ] ) => ( {
					slug,
					color: value,
					name: titleCase( slug ),
				} ) ),
			},
			...( families.size && {
				typography: {
					...( settings.typography as object ),
					fontFamilies: [ ...families ].map( ( [ family, { fallback } ] ) => ( {
						slug: slugify( family ),
						name: family,
						fontFamily: `"${ family }", ${ fallback }`,
						...( fontFaces[ family ] && { fontFace: fontFaces[ family ] } ),
					} ) ),
					fontSizes: styles
						.filter( ( [ , style ] ) => style.fontSize !== undefined )
						.map( ( [ slug, style ] ) => ( {
							slug,
							size: dimension( style.fontSize ),
							name: titleCase( slug ),
						} ) ),
				},
			} ),
			...( spacing.length && {
				spacing: {
					...( settings.spacing as object ),
					spacingSizes: spacing.map( ( [ slug, value ] ) => ( {
						slug,
						size: dimension( value ),
						name: SPACING_NAMES[ slug ] ?? titleCase( slug ),
					} ) ),
				},
			} ),
			...( Object.keys( rounded ).length && {
				custom: {
					...( settings.custom as object ),
					rounded: Object.fromEntries(
						Object.entries( rounded ).map( ( [ key, value ] ) => [ key, dimension( value ) ] )
					),
				},
			} ),
		},
		styles: {
			...themeJson.styles,
			color: compact( { background: color( 'background' ), text: color( 'text' ) } ),
			typography: typography( byName.body, true ),
			elements: compact( {
				heading: compact( {
					typography: typography( byName.headline ?? byName.heading ?? byName.display, false ),
				} ),
				link: color( 'primary' ) && { color: { text: color( 'primary' ) } },
				button:
					button &&
					compact( {
						color: compact( {
							background: button.backgroundColor !== undefined && resolve( button.backgroundColor ),
							text: button.textColor !== undefined && resolve( button.textColor ),
						} ),
						border: button.rounded !== undefined && { radius: resolve( button.rounded ) },
						spacing: padding.length > 0 && { padding: { top, right, bottom, left } },
						typography: typography( byName.label, true ),
					} ),
			} ),
		},
	};

	return {
		themeJson: result,
		fontsUrl: googleFontsUrl( styles.map( ( [ , style ] ) => style ) ),
		summary: [
			plural( colors.length, 'color', 'colors' ),
			plural( families.size, 'font family', 'font families' ),
			plural( styles.length, 'text style', 'text styles' ),
			plural( spacing.length, 'spacing step', 'spacing steps' ),
		].join( ', ' ),
	};
}

export function luminance( color: string ): number {
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
	/** Follows a `{colors.primary}`-style reference to its token value. */
	resolve: ( value: unknown ) => unknown;
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
		throw new Error(
			'The DESIGN.md front matter needs at least two colors, as quoted hex values (primary: "#c2552b"), and one typography style.'
		);
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
		resolve,
	};
}

export interface DesignDrift {
	kind: 'color' | 'font-family' | 'font-files' | 'font-size' | 'spacing';
	slug: string;
	design: string;
	/** The theme.json value, or undefined when theme.json lacks the token. */
	theme?: string;
}

/** Settles one drift, by writing the DESIGN.md value to theme.json or the other way around. */
export interface DesignFix {
	kind: DesignDrift[ 'kind' ];
	slug: string;
	to: 'theme' | 'design';
}

type Preset = { slug?: unknown; [ key: string ]: unknown };

const PRESET_LISTS: Record< DesignDrift[ 'kind' ], [ string, string, string ] > = {
	color: [ 'color', 'palette', 'color' ],
	'font-family': [ 'typography', 'fontFamilies', 'fontFamily' ],
	'font-files': [ 'typography', 'fontFamilies', 'fontFace' ],
	'font-size': [ 'typography', 'fontSizes', 'size' ],
	spacing: [ 'spacing', 'spacingSizes', 'size' ],
};

function presets( settings: unknown, group: string, list: string ): Preset[] {
	const value = ( settings as Record< string, Record< string, unknown > > | undefined )?.[
		group
	]?.[ list ];
	return Array.isArray( value ) ? value : [];
}

/**
 * Where a theme.json no longer matches the DESIGN.md it was generated from: every
 * palette color, font family, font size and spacing step that theme.json lacks
 * or sets to a different value, and every font family it declares without font files.
 * A theme.json that uses fewer than half of DESIGN.md's palette slugs wasn't generated
 * from it (e.g. the default theme before the design is built), so it has no drift.
 */
export function designDrift( tokens: DesignTokens, themeJson: ThemeJson ): DesignDrift[] {
	const expected = themeJsonFromDesign( tokens, {} )?.themeJson.settings;
	const palette = presets( themeJson.settings, 'color', 'palette' );
	const colors = presets( expected, 'color', 'palette' );
	const shared = colors.filter( ( color ) =>
		palette.some( ( candidate ) => candidate.slug === color.slug )
	);
	if ( shared.length * 2 < colors.length ) {
		return [];
	}
	const normalize = ( kind: DesignDrift[ 'kind' ], value: unknown ) =>
		kind === 'font-family'
			? fontFamilyName( value ).toLowerCase()
			: String( value ).replace( /\s+/g, '' ).toLowerCase();
	const drift = ( [ 'color', 'font-family', 'font-size', 'spacing' ] as const ).flatMap(
		( kind ): DesignDrift[] => {
			const [ group, list, field ] = PRESET_LISTS[ kind ];
			const actual = presets( themeJson.settings, group, list );
			return presets( expected, group, list ).flatMap( ( preset ) => {
				const design = kind === 'font-family' ? String( preset.name ) : String( preset[ field ] );
				const match = actual.find( ( candidate ) => candidate.slug === preset.slug );
				const theme =
					match?.[ field ] === undefined
						? undefined
						: kind === 'font-family'
						? fontFamilyName( match[ field ] )
						: String( match[ field ] );
				return theme !== undefined && normalize( kind, design ) === normalize( kind, theme )
					? []
					: [ { kind, slug: String( preset.slug ), design, theme } ];
			} );
		}
	);
	const unloaded = presets( themeJson.settings, 'typography', 'fontFamilies' ).filter(
		( family ) =>
			! ( Array.isArray( family.fontFace ) && family.fontFace.length ) &&
			! drift.some( ( entry ) => entry.kind === 'font-family' && entry.slug === family.slug ) &&
			presets( expected, 'typography', 'fontFamilies' ).some(
				( preset ) => preset.slug === family.slug
			)
	);
	return [
		...drift,
		...unloaded.map( ( family ) => ( {
			kind: 'font-files' as const,
			slug: String( family.slug ),
			design: fontFamilyName( family.fontFamily ),
		} ) ),
	];
}

/**
 * Writes the DESIGN.md value of each drift into theme.json: the preset DESIGN.md
 * generates replaces the one theme.json has under that slug, or is added.
 * `fontFaces` carries the downloaded font files of the families being written.
 */
export function applyDesignToThemeJson(
	tokens: DesignTokens,
	themeJson: ThemeJson,
	drift: DesignDrift[],
	fontFaces: Record< string, object[] > = {}
): ThemeJson {
	const expected = themeJsonFromDesign( tokens, {}, fontFaces )?.themeJson.settings;
	const settings = structuredClone( themeJson.settings ?? {} ) as Record<
		string,
		Record< string, unknown >
	>;
	for ( const { kind, slug } of drift ) {
		const [ group, list ] = PRESET_LISTS[ kind ];
		const preset = presets( expected, group, list ).find( ( entry ) => entry.slug === slug );
		if ( ! preset ) {
			continue;
		}
		const current = presets( settings, group, list );
		const index = current.findIndex( ( entry ) => entry.slug === slug );
		settings[ group ] = {
			...settings[ group ],
			[ list ]:
				index === -1
					? [ ...current, preset ]
					: current.map( ( entry, position ) => ( position === index ? preset : entry ) ),
		};
	}
	return { ...themeJson, settings };
}

/**
 * Writes the theme.json value of each drift back into the DESIGN.md front matter,
 * leaving the rest of the document as written. Drifts theme.json has no value for
 * are skipped.
 */
export function applyThemeToDesign( design: string, drift: DesignDrift[] ): string {
	const frontMatter = design.match( /^\s*---\r?\n([\s\S]*?)\r?\n---/ )?.[ 1 ];
	if ( frontMatter === undefined ) {
		return design;
	}
	const document = parseDocument( frontMatter );
	const typography = typographyStyles( parseDesignMd( design ) );
	for ( const { kind, slug, design: value, theme } of drift ) {
		if ( theme === undefined ) {
			continue;
		}
		if ( kind === 'color' ) {
			document.setIn( [ 'colors', slug ], theme );
		} else if ( kind === 'spacing' ) {
			document.setIn( [ 'spacing', slug ], theme );
		} else if ( kind === 'font-size' ) {
			document.setIn( [ 'typography', slug, 'fontSize' ], theme );
		} else if ( kind === 'font-family' ) {
			for ( const [ name, style ] of typography ) {
				if ( fontFamilyName( style.fontFamily ) === value ) {
					document.setIn(
						[ 'typography', name, 'fontFamily' ],
						String( style.fontFamily ).replace( value, theme )
					);
				}
			}
		}
	}
	return design.replace( frontMatter, () =>
		document.toString( { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE' } ).replace( /\n$/, '' )
	);
}

function compact< T extends Record< string, unknown > >( object: T ): Partial< T > | undefined {
	const entries = Object.entries( object ).filter(
		( [ , value ] ) =>
			value !== undefined &&
			value !== false &&
			value !== '' &&
			! ( typeof value === 'object' && value !== null && ! Object.keys( value ).length )
	);
	return entries.length ? ( Object.fromEntries( entries ) as Partial< T > ) : undefined;
}
