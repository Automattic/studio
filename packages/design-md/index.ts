import { parse } from 'yaml';

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
