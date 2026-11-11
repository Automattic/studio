/**
 * A theme's Global Styles: the wp_global_styles post WordPress merges over its
 * theme.json, which it reads only when its JSON carries
 * "isGlobalStylesUserThemeJSON": true, and only the newest published one
 * whose wp_theme term names the theme
 * (WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles()).
 */
import { savedPosts, type SavedPost } from '@studio/agent/node/saved-copies';
import { AS_ADMINISTRATOR, wpEvalJson } from '@studio/agent/shared/tools/utils';
import type { WordPressSite } from '@studio/agent/node/site-database';
import type { HostSite, StudioAgentHost } from '@studio/agent/shared/host';

export const GLOBAL_STYLES = 'wp_global_styles';

/** The Global Styles post WordPress reads for `theme`, read from an open site's database. */
export function themeGlobalStyles( site: WordPressSite, theme: string ): SavedPost | undefined {
	return savedPosts( site, theme ).find( ( post ) => post.postType === GLOBAL_STYLES );
}

// The styles WordPress resolves for the site, as the stylesheet it prints
// names them: the merged styles (wp_get_global_styles()) with each preset and
// custom variable replaced by the value WordPress defines it as, from the
// merged settings (wp_get_global_settings(), WP_Theme_JSON::compute_preset_vars()
// and compute_theme_vars()), and a font family preset by its name. A value
// naming a variable or ref WordPress defines no value for is unresolved.
const RESOLVED_STYLES = `
$studio_styles = function () {
	$settings = wp_get_global_settings();
	$styles = wp_get_global_styles();
	$vars = array();
	foreach ( array( 'compute_preset_vars' => array( $settings, WP_Theme_JSON::VALID_ORIGINS ), 'compute_theme_vars' => array( $settings ) ) as $method => $args ) {
		$compute = new ReflectionMethod( 'WP_Theme_JSON', $method );
		$compute->setAccessible( true );
		foreach ( $compute->invokeArgs( null, $args ) as $declaration ) {
			$vars[ $declaration['name'] ] = (string) $declaration['value'];
		}
	}
	$names = array();
	foreach ( (array) ( $settings['typography']['fontFamilies'] ?? array() ) as $families ) {
		foreach ( (array) $families as $family ) {
			if ( isset( $family['slug'], $family['name'] ) ) {
				$names[ '--wp--preset--font-family--' . $family['slug'] ] = $family['name'];
			}
		}
	}
	// Where a preset of each kind is defined, by its variable's prefix.
	$kinds = array();
	foreach ( WP_Theme_JSON::PRESETS_METADATA as $metadata ) {
		if ( empty( $metadata['css_vars'] ) ) {
			continue;
		}
		$kinds[ str_replace( '$slug', '', $metadata['css_vars'] ) ] = 'settings.' . implode( '.', $metadata['path'] );
	}
	$resolve = function ( $value ) use ( $vars, $names, $kinds, $styles ) {
		$missing = array();
		if ( is_array( $value ) && isset( $value['ref'] ) ) {
			$ref = _wp_array_get( array( 'styles' => $styles ), explode( '.', (string) $value['ref'] ), null );
			if ( ! is_scalar( $ref ) ) {
				return array( 'missing' => array( 'ref ' . $value['ref'] . ', which holds no value' ) );
			}
			$value = $ref;
		}
		if ( ! is_scalar( $value ) ) {
			return null;
		}
		$css = (string) $value;
		if ( str_starts_with( $css, 'var:' ) ) {
			$css = 'var(--wp--' . str_replace( '|', '--', substr( $css, 4 ) ) . ')';
		}
		$name = null;
		for ( $i = 0; $i < 5 && preg_match_all( '/var\\(\\s*(--wp--(?:preset|custom)--[\\w-]+)\\s*\\)/', $css, $found, PREG_SET_ORDER ); $i++ ) {
			foreach ( $found as $var ) {
				if ( isset( $vars[ $var[1] ] ) ) {
					$name = $name ?? ( $names[ $var[1] ] ?? null );
					$css = str_replace( $var[0], $vars[ $var[1] ], $css );
					continue;
				}
				$why = $var[1] . ', which WordPress defines no value for';
				foreach ( $kinds as $prefix => $path ) {
					if ( str_starts_with( $var[1], $prefix ) ) {
						$why = $var[1] . ': the site has no "' . substr( $var[1], strlen( $prefix ) ) . '" in ' . $path;
						break;
					}
				}
				$missing[] = $why;
				$css = str_replace( $var[0], '', $css );
			}
		}
		return $missing ? array( 'missing' => $missing ) : array_filter( array( 'value' => $css, 'name' => $name ) );
	};
	$items = array(
		'body font' => array( 'typography', 'fontFamily' ),
		'body size' => array( 'typography', 'fontSize' ),
		'text' => array( 'color', 'text' ),
		'background' => array( 'color', 'background' ),
		'heading font' => array( 'elements', 'heading', 'typography', 'fontFamily' ),
		'heading weight' => array( 'elements', 'heading', 'typography', 'fontWeight' ),
		'link' => array( 'elements', 'link', 'color', 'text' ),
		'button text' => array( 'elements', 'button', 'color', 'text' ),
		'button background' => array( 'elements', 'button', 'color', 'background' ),
	);
	foreach ( array( 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' ) as $level ) {
		$items[ "$level font" ] = array( 'elements', $level, 'typography', 'fontFamily' );
	}
	$resolved = array();
	foreach ( $items as $item => $path ) {
		$value = _wp_array_get( $styles, $path, null );
		if ( null !== $value && null !== ( $found = $resolve( $value ) ) ) {
			$resolved[ $item ] = $found;
		}
	}
	// Each value of the user's own styles that resolves to nothing.
	// Each named as the saved post holds it, as the file it was saved from did.
	$unresolved = array();
	$saved = json_decode( (string) ( WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles( wp_get_theme() )['post_content'] ?? '' ), true );
	$walk = function ( $node, $path ) use ( &$walk, &$unresolved, $resolve, $saved ) {
		if ( ! is_array( $node ) || isset( $node['ref'] ) ) {
			$found = $resolve( $node );
			if ( isset( $found['missing'] ) ) {
				$unresolved[] = array( 'path' => implode( '.', $path ), 'value' => _wp_array_get( (array) $saved, $path, $node ), 'missing' => $found['missing'] );
			}
			return;
		}
		foreach ( $node as $key => $child ) {
			$walk( $child, array_merge( $path, array( $key ) ) );
		}
	};
	$walk( WP_Theme_JSON_Resolver::get_user_data()->get_raw_data()['styles'] ?? array(), array( 'styles' ) );
	// Each font file the user's font families name in the theme that it lacks:
	// WP_Font_Face_Resolver turns file:./ into get_theme_file_uri()'s address.
	$font_files = array();
	foreach ( (array) ( $settings['typography']['fontFamilies']['custom'] ?? array() ) as $family ) {
		foreach ( (array) ( $family['fontFace'] ?? array() ) as $face ) {
			foreach ( (array) ( $face['src'] ?? array() ) as $src ) {
				if ( is_string( $src ) && str_starts_with( $src, 'file:./' ) && ! file_exists( get_theme_file_path( substr( $src, 7 ) ) ) ) {
					$font_files[] = array( 'family' => $family['name'] ?? $family['slug'] ?? '', 'src' => $src, 'path' => get_theme_file_path( substr( $src, 7 ) ) );
				}
			}
		}
	}
	return array( 'resolved' => (object) $resolved, 'unresolved' => $unresolved, 'fontFiles' => $font_files );
};
`;

// The style paths of `node`: each value, and each ref.
const STYLE_PATHS = `
$style_paths = function ( $node, $path ) use ( &$style_paths ) {
	if ( ! is_array( $node ) || isset( $node['ref'] ) || ( $node && array_is_list( $node ) ) ) {
		return array( implode( '.', $path ) );
	}
	$paths = array();
	foreach ( $node as $key => $child ) {
		$paths = array_merge( $paths, $style_paths( $child, array_merge( $path, array( $key ) ) ) );
	}
	return $paths;
};
`;

interface ResolvedValue {
	value?: string;
	name?: string;
	missing?: string[];
}

interface ResolvedStyles {
	resolved: Record< string, ResolvedValue >;
	unresolved: Array< { path: string; value: unknown; missing: string[] } >;
	fontFiles: Array< { family: string; src: string; path: string } >;
}

/** What WordPress resolves a save of Global Styles to, and what it did not. */
export interface SavedGlobalStyles {
	refused?: string;
	before?: ResolvedStyles;
	after?: ResolvedStyles;
	// The style paths the saved data held that WordPress dropped from it.
	dropped?: string[];
}

// The style paths `$data`, a decoded Global Styles JSON, held that WordPress
// dropped from the user's styles it applies (WP_Theme_JSON::sanitize()).
const droppedPhp = (
	data: string
) => `$kept = $style_paths( WP_Theme_JSON_Resolver::get_user_data()->get_raw_data()['styles'] ?? array(), array( 'styles' ) );
$dropped = array_values( array_diff( is_array( ${ data }['styles'] ?? null ) ? $style_paths( ${ data }['styles'], array( 'styles' ) ) : array(), $kept ) );`;

const savePhp = ( post: string, data: string, resolve: boolean ) => `$data = ${ data };
if ( ! is_array( $data ) ) { echo wp_json_encode( array( 'refused' => 'it is not a JSON object' ) ); return; }
${ resolve ? RESOLVED_STYLES + STYLE_PATHS + '$before = $studio_styles();' : '' }
${ AS_ADMINISTRATOR }
$request = new WP_REST_Request( 'PUT', '/wp/v2/global-styles/' . ( ${ post } ) );
$request->set_body_params( array( 'settings' => $data['settings'] ?? array(), 'styles' => $data['styles'] ?? array() ) );
$response = rest_do_request( $request );
if ( $response->is_error() ) { echo wp_json_encode( array( 'refused' => $response->as_error()->get_error_message() ) ); return; }
${
	resolve
		? `wp_clean_theme_json_cache();
$after = $studio_styles();
${ droppedPhp( '$data' ) }
echo wp_json_encode( array( 'before' => $before, 'after' => $after, 'dropped' => $dropped ) );`
		: "echo wp_json_encode( array( 'refused' => null ) );"
}`;

/**
 * Saves Global Styles as the Site Editor saves them: a PUT of their settings
 * and styles to /wp/v2/global-styles/<ID> as an administrator, whose controller
 * sanitizes them, keeps isGlobalStylesUserThemeJSON and the schema version, and
 * validates custom CSS (WP_REST_Global_Styles_Controller::update_item()). What
 * `data` leaves out, it clears. `post` and `data` are PHP expressions: the
 * post's ID, and the decoded JSON to save. Returns why WordPress refused, or
 * undefined once saved.
 */
export async function saveGlobalStyles(
	host: StudioAgentHost,
	site: HostSite,
	post: string,
	data: string
): Promise< string | undefined > {
	const { refused } = await wpEvalJson< SavedGlobalStyles >(
		host,
		site,
		savePhp( post, data, false )
	);
	return refused ?? undefined;
}

/**
 * Saves Global Styles as saveGlobalStyles() does, and returns what WordPress
 * resolves the site's styles to before and after the save, in the same run.
 */
export async function saveResolvedGlobalStyles(
	host: StudioAgentHost,
	site: HostSite,
	post: string,
	data: string
): Promise< SavedGlobalStyles > {
	return wpEvalJson< SavedGlobalStyles >( host, site, savePhp( post, data, true ) );
}

// What WordPress resolves the site's styles to now, and what of the Global
// Styles post it reads it dropped; none when WordPress ignores the post, as
// one without the flag.
const RESOLVE_PHP = `${ RESOLVED_STYLES }${ STYLE_PATHS }
$after = $studio_styles();
$saved = json_decode( (string) ( WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles( wp_get_theme() )['post_content'] ?? '' ), true );
$dropped = array();
if ( is_array( $saved ) && ! empty( $saved['isGlobalStylesUserThemeJSON'] ) ) {
	${ droppedPhp( '$saved' ) }
}
echo wp_json_encode( array( 'after' => $after, 'dropped' => $dropped ) );`;

/**
 * What WordPress resolves the site's styles to now, as saveResolvedGlobalStyles()
 * returns after a save, with no state before it.
 */
export async function resolveGlobalStyles(
	host: StudioAgentHost,
	site: HostSite
): Promise< SavedGlobalStyles > {
	return wpEvalJson< SavedGlobalStyles >( host, site, RESOLVE_PHP );
}

// The Global Styles post versions, by site, whose resolved styles a save stated,
// so a check of the same call does not state them again.
const stated = new Map< string, string >();

/** A save stated what WordPress resolves the styles to, with the theme's post at `version`. */
export function stateResolvedStyles( sitePath: string, version: string ): void {
	stated.set( sitePath, version );
}

/** Whether a save stated the resolved styles with the theme's post at `version`; asked once. */
export function resolvedStylesStated( sitePath: string, version: string ): boolean {
	const was = stated.get( sitePath );
	stated.delete( sitePath );
	return was === version;
}

// The resolved styles, each part as the stylesheet sets it.
const PARTS: Array<
	[ string, ( styles: Record< string, ResolvedValue > ) => string | undefined ]
> = [
	[
		'body text',
		( styles ) =>
			join( [
				font( styles[ 'body font' ] ),
				value( styles[ 'body size' ] ),
				colors( styles.text ),
			] ),
	],
	[ 'page background', ( styles ) => value( styles.background ) ],
	[
		'headings',
		( styles ) =>
			join( [
				font( styles[ 'heading font' ] ),
				styles[ 'heading weight' ]?.value && `weight ${ styles[ 'heading weight' ].value }`,
				...[ 1, 2, 3, 4, 5, 6 ]
					.filter( ( level ) => styles[ `h${ level } font` ] )
					.map( ( level ) => `h${ level } ${ font( styles[ `h${ level } font` ] ) }` ),
			] ),
	],
	[ 'links', ( styles ) => value( styles.link ) ],
	[
		'buttons',
		( styles ) =>
			[ value( styles[ 'button text' ] ), value( styles[ 'button background' ] ) ]
				.filter( Boolean )
				.join( ' on ' ) || undefined,
	],
];

// A value naming what WordPress defines no value for is stated as unresolved.
const UNRESOLVED = 'unresolved';
const value = ( resolved?: ResolvedValue ) => ( resolved?.missing ? UNRESOLVED : resolved?.value );
const colors = ( resolved?: ResolvedValue ) => value( resolved ) && `color ${ value( resolved ) }`;
const font = ( resolved?: ResolvedValue ) =>
	resolved?.missing
		? `${ UNRESOLVED } font`
		: resolved?.value &&
		  ( resolved.name && resolved.name !== resolved.value
				? `${ resolved.name } (${ resolved.value })`
				: resolved.value );
const join = ( parts: Array< string | undefined | false > ) =>
	parts.filter( Boolean ).join( ', ' ) || undefined;

// Enough of the user's unresolved values to show which and why.
const MAX_UNRESOLVED = 5;

/**
 * What a save of Global Styles leaves WordPress resolving: the site's body
 * text, background, headings, links and buttons, and what of them the save
 * changed; and each of its values that takes no effect.
 */
export function describeSavedGlobalStyles( saved: SavedGlobalStyles ): {
	summary?: string;
	problems: string[];
} {
	const { before, after, dropped = [] } = saved;
	if ( ! after ) {
		return { problems: [] };
	}
	const parts = PARTS.map( ( [ label, describe ] ) => {
		const now = describe( after.resolved );
		const was = before ? describe( before.resolved ) : now;
		return { label, now, changed: now !== was };
	} );
	const stated = parts.filter( ( part ) => part.now );
	const changed = parts.filter( ( part ) => part.changed ).map( ( part ) => part.label );
	const summary = stated.length
		? `WordPress now resolves the site's styles to: ${ stated
				.map( ( part ) => `${ part.label } ${ part.now }` )
				.join(
					'; '
				) } (wp_get_global_styles() and wp_get_global_settings() in wp-includes/global-styles-and-settings.php).${
				// What a save changed is known only from the styles before it.
				! before
					? ''
					: changed.length
					? ` This save changed: ${ changed.join( ', ' ) }.`
					: ' This save changed none of these.'
		  }`
		: undefined;
	const problems = [
		...after.unresolved
			.slice( 0, MAX_UNRESOLVED )
			.map(
				( { path, value: raw, missing } ) =>
					`${ path } is ${ JSON.stringify(
						raw
					) }, which WordPress resolves to nothing, so browsers treat that property as unset: it names ${ missing.join(
						'; '
					) } (wp_get_global_settings()).`
			),
		...after.fontFiles.map(
			( { family, src, path } ) =>
				`Font family "${ family }" loads ${ src }, which WordPress serves from the active theme (get_theme_file_uri() in WP_Font_Face_Resolver), but there is no ${ path }, so browsers fall back to the next font in its stack.`
		),
		...( dropped.length
			? [
					`WordPress did not keep ${ dropped
						.slice( 0, MAX_UNRESOLVED )
						.join(
							', '
						) }: theme.json defines no such style, so WP_Theme_JSON::sanitize() (wp-includes/class-wp-theme-json.php) removed ${
						dropped.length > 1 ? 'them' : 'it'
					} from the styles it applies.`,
			  ]
			: [] ),
	];
	return { summary, problems };
}
