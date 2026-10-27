/**
 * The presets a site's blocks and styles use, as WordPress resolves them:
 * wp_get_global_settings() merges core's theme.json, the parent and child
 * themes' and the user's Global Styles (WP_Theme_JSON_Resolver), the same data
 * the editor shows. Each preset is named by the slug a block attribute or a
 * `var(--wp--preset--…)` takes.
 *
 * Resolving them runs WordPress, so they are resolved again only when what
 * they are resolved from changes: the themes' files, the user's Global
 * Styles, the active plugins (which can filter theme.json) and WordPress.
 *
 * A theme that is not active is resolved as the Site Editor previews it
 * (wp-includes/theme-previews.php): with the stylesheet and template filtered
 * to it, so its files are read with the presets they render with once it is.
 */
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { readWordPressSite, type WordPressSite } from 'cli/ai/site-database';
import { activeThemes, readThemeHeader } from 'cli/ai/themes';
import { resolveSite } from 'cli/ai/tools/utils';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import type { SiteFile } from 'cli/ai/site-file-guards';

interface Presets {
	colors: Array< [ string, string ] >;
	fontFamilies: Array< [ string, string ] >;
	fontSizes: Array< [ string, string ] >;
	spacingSizes: Array< [ string, string ] >;
	layout: { contentSize?: string; wideSize?: string };
	/** Each CSS property theme.json styles hold, by its path in `styles` (WP_Theme_JSON::PROPERTIES_METADATA). */
	styleProperties: Record< string, string >;
	/**
	 * The theme's presets WordPress drops for core's default of the same slug,
	 * by preset path: those whose `default…` setting is on.
	 */
	shadowed: Array< { path: string; setting: string; presets: Array< [ string, string ] > } >;
	/** The titles of the style variations the Site Editor offers (STYLE_VARIATIONS). */
	styleVariations?: string[];
}

/**
 * The theme's style variations the Site Editor's Styles offers to browse,
 * from its and its parent's styles/*.json (WP_Theme_JSON_Resolver::get_style_variations()):
 * the whole looks, leaving out those that set only colors or only typography
 * and spacing, which it offers under Colors and Typography instead, as its
 * StyleVariationsContainer does with isVariationWithProperties().
 */
export const STYLE_VARIATIONS = `
function style_variations_offered() {
	$only = function ( $node, $properties ) use ( &$only ) {
		$kept = array();
		foreach ( $node as $key => $value ) {
			if ( in_array( $key, $properties, true ) ) {
				$kept[ $key ] = $value;
			} elseif ( is_array( $value ) && ( $inner = $only( $value, $properties ) ) ) {
				$kept[ $key ] = $inner;
			}
		}
		return $kept;
	};
	$sets_only = function ( $variation, $properties ) use ( $only ) {
		$kept = $only( $variation, $properties );
		return ( $kept['settings'] ?? null ) === ( $variation['settings'] ?? null ) && ( $kept['styles'] ?? null ) === ( $variation['styles'] ?? null );
	};
	$offered = array();
	foreach ( WP_Theme_JSON_Resolver::get_style_variations() as $variation ) {
		if ( ! $sets_only( $variation, array( 'color' ) ) && ! $sets_only( $variation, array( 'typography', 'spacing' ) ) ) {
			$offered[] = $variation;
		}
	}
	return $offered;
}
`;

// The presets of each origin the editor offers, in WordPress's order: core's
// unless the theme turns them off, then the theme's, then the user's.
const RESOLVE = `${ STYLE_VARIATIONS }
$settings = wp_get_global_settings();
// The theme's presets that merging into core's drops (WP_Theme_JSON::merge()).
$theme_settings = WP_Theme_JSON_Resolver::get_theme_data()->get_settings();
$shadowed = array();
foreach ( WP_Theme_JSON::PRESETS_METADATA as $metadata ) {
	$kept = wp_list_pluck( _wp_array_get( $settings, array_merge( $metadata['path'], array( 'theme' ) ), array() ), 'slug' );
	$defaults = array();
	foreach ( _wp_array_get( $settings, array_merge( $metadata['path'], array( 'default' ) ), array() ) as $preset ) {
		// The value WordPress renders, as get_settings_values_by_slug() takes it.
		$value = isset( $metadata['value_key'] ) ? ( $preset[ $metadata['value_key'] ] ?? '' ) : ( is_callable( $metadata['value_func'] ?? null ) ? call_user_func( $metadata['value_func'], $preset, $settings ) : '' );
		$defaults[ $preset['slug'] ] = is_scalar( $value ) ? (string) $value : wp_json_encode( $value );
	}
	$presets = array();
	foreach ( _wp_array_get( $theme_settings, array_merge( $metadata['path'], array( 'theme' ) ), array() ) as $preset ) {
		if ( ! in_array( $preset['slug'], $kept, true ) ) {
			$presets[] = array( $preset['slug'], $defaults[ $preset['slug'] ] ?? '' );
		}
	}
	if ( $presets ) {
		$shadowed[] = array( 'path' => implode( '.', $metadata['path'] ), 'setting' => implode( '.', $metadata['prevent_override'] ), 'presets' => $presets );
	}
}
$presets = function ( $path, $default_flag, $value ) use ( $settings ) {
	$by_origin = _wp_array_get( $settings, $path, array() );
	$origins = array( 'theme', 'custom' );
	if ( $default_flag && _wp_array_get( $settings, $default_flag, true ) ) {
		array_unshift( $origins, 'default' );
	}
	$presets = array();
	foreach ( $origins as $origin ) {
		foreach ( $by_origin[ $origin ] ?? array() as $preset ) {
			$presets[ $preset['slug'] ] = array( $preset['slug'], (string) ( is_array( $preset[ $value ] ?? '' ) ? wp_json_encode( $preset[ $value ] ) : ( $preset[ $value ] ?? '' ) ) );
		}
	}
	return array_values( $presets );
};
echo wp_json_encode( array(
	'colors' => $presets( array( 'color', 'palette' ), array( 'color', 'defaultPalette' ), 'color' ),
	'fontFamilies' => $presets( array( 'typography', 'fontFamilies' ), null, 'name' ),
	'fontSizes' => $presets( array( 'typography', 'fontSizes' ), array( 'typography', 'defaultFontSizes' ), 'size' ),
	'spacingSizes' => $presets( array( 'spacing', 'spacingSizes' ), array( 'spacing', 'defaultSpacingSizes' ), 'size' ),
	'layout' => array_filter( array(
		'contentSize' => $settings['layout']['contentSize'] ?? null,
		'wideSize' => $settings['layout']['wideSize'] ?? null,
	) ),
	'styleProperties' => array_map( function ( $path ) { return implode( '.', $path ); }, WP_Theme_JSON::PROPERTIES_METADATA ),
	'shadowed' => $shadowed,
	'styleVariations' => wp_list_pluck( style_variations_offered(), 'title' ),
) );
`;

// The theme previewed in its place, as wp_get_theme_preview_path() gives it.
const preview = ( theme: string ) => `
$preview = wp_get_theme( '${ theme.replace( /[\\']/g, '\\$&' ) }' );
if ( $preview->exists() ) {
	add_filter( 'stylesheet', function () use ( $preview ) { return $preview->get_stylesheet(); } );
	add_filter( 'template', function () use ( $preview ) { return $preview->get_template(); } );
}
`;

// By site and the theme resolved, '' for the active one.
const resolved = new Map< string, { inputs: string; presets: Promise< Presets > } >();

async function filesVersion( dir: string ): Promise< string > {
	const entries = await readdir( dir, { recursive: true, withFileTypes: true } ).catch( () => [] );
	const versions = await Promise.all(
		entries
			.filter( ( entry ) => entry.isFile() && /\.json$/.test( entry.name ) )
			.map( async ( entry ) => {
				const file = path.join( entry.parentPath, entry.name );
				const { mtimeMs, size } = await stat( file );
				return `${ path.relative( dir, file ) }:${ mtimeMs }:${ size }`;
			} )
	);
	return versions.sort().join( ',' );
}

// What WordPress resolves the presets from, as one version.
async function inputsOf( site: WordPressSite, themes: string[] ): Promise< string > {
	const userStyles = site.query< { modified: string; size: number } >(
		`SELECT post_modified_gmt AS modified, LENGTH( post_content ) AS size FROM ${ site.prefix }posts WHERE post_type = 'wp_global_styles' ORDER BY ID`
	);
	const themeFiles = await Promise.all(
		themes.map( ( theme ) => filesVersion( path.join( site.root, 'wp-content', 'themes', theme ) ) )
	);
	const wordpress = await stat( path.join( site.root, 'wp-includes', 'version.php' ) ).catch(
		() => undefined
	);
	return JSON.stringify( [
		themes,
		themeFiles,
		userStyles,
		site.option( 'active_plugins' ),
		wordpress?.mtimeMs,
	] );
}

async function resolve( root: string, theme: string | undefined ): Promise< Presets > {
	const site = await resolveSite( root );
	try {
		await connectToDaemon();
		await using command = await runWpCliCommand( site, [
			'eval',
			( theme ? preview( theme ) : '' ) + RESOLVE,
		] );
		const [ output, exitCode ] = await Promise.all( [
			command.response.stdoutText,
			command.response.exitCode,
		] );
		if ( exitCode !== 0 ) {
			throw new Error( `wp eval exited ${ exitCode }` );
		}
		return JSON.parse( output.slice( output.indexOf( '{' ) ) ) as Presets;
	} finally {
		await disconnectFromDaemon();
	}
}

// The presets as fact lines, one per kind of preset the site has.
function describePresets( presets: Presets ): string[] {
	const list = ( name: string, items: Array< [ string, string ] >, quoted = false ) =>
		items.length
			? `${ name } presets (wp_get_global_settings()): ${ items
					.map( ( [ slug, value ] ) => `${ slug } ${ quoted ? JSON.stringify( value ) : value }` )
					.join( ', ' ) }.`
			: undefined;
	const { contentSize, wideSize } = presets.layout;
	const variations = presets.styleVariations ?? [];
	return [
		list( 'Color', presets.colors ),
		list( 'Font family', presets.fontFamilies, true ),
		list( 'Font size', presets.fontSizes ),
		list( 'Spacing size', presets.spacingSizes ),
		contentSize || wideSize
			? `Layout (wp_get_global_settings()): content width ${ contentSize ?? 'none' }, wide width ${
					wideSize ?? 'none'
			  }.`
			: undefined,
		variations.length
			? `Style variations the Site Editor's Styles offers (its styles/*.json, WP_Theme_JSON_Resolver::get_style_variations()): ${ variations.join(
					', '
			  ) }. Choosing one saves its settings and styles as the site's Global Styles (WP_Theme_JSON_Resolver::get_user_global_styles_post_id()).`
			: undefined,
	].filter( ( line ): line is string => Boolean( line ) );
}

/**
 * The site's presets, as WordPress resolves them with `theme` active (the
 * active theme by default), or undefined when there is no such theme or
 * WordPress could not run, in which case they are resolved again next time.
 */
export async function themePresets(
	site: WordPressSite,
	theme?: string
): Promise< Presets | undefined > {
	const active = activeThemes( site );
	// An active child theme's parent renders with the child's presets merged in.
	const previewed = theme && ! active.includes( theme ) ? theme : undefined;
	const parent =
		previewed && ( await readThemeHeader( site.root, previewed, 'Template' ).catch( () => '' ) );
	const themes = previewed ? [ ...new Set( [ previewed, parent || previewed ] ) ] : active;
	if ( ! themes.length ) {
		return undefined;
	}
	const inputs = await inputsOf( site, themes );
	const key = `${ site.root }\0${ previewed ?? '' }`;
	let entry = resolved.get( key );
	if ( entry?.inputs !== inputs ) {
		entry = { inputs, presets: resolve( site.root, previewed ) };
		resolved.set( key, entry );
		entry.presets.catch( () => resolved.delete( key ) );
	}
	return entry.presets.catch( () => undefined );
}

/**
 * The presets of a theme.json just written that WordPress replaces with core's
 * default of the same slug: a block or style that takes the slug gets core's
 * value.
 */
export async function shadowedPresetNotes( siteFile: SiteFile ): Promise< string[] > {
	if ( siteFile.theme?.file !== 'theme.json' ) {
		return [];
	}
	const { slug, dir } = siteFile.theme;
	const presets = await readWordPressSite( siteFile.siteRoot, ( site ) =>
		themePresets( site, slug )
	);
	const themeJson = path.join( dir, 'theme.json' );
	return ( presets?.shadowed ?? [] ).map(
		( { path: at, setting, presets: replaced } ) =>
			`WordPress replaces ${ themeJson }'s settings.${ at } ${ replaced
				.map( ( [ slug ] ) => slug )
				.join( ', ' ) } with core's default ${ at } of the same slug (${ replaced
				.map( ( [ slug, value ] ) => `${ slug } ${ value }` )
				.join(
					', '
				) }), because settings.${ setting } is on (WP_Theme_JSON::merge() in wp-includes/class-wp-theme-json.php), so a block or style that takes these slugs gets core's value. Setting settings.${ setting } to false keeps the theme's, and takes core's defaults of this kind out of the editor, as Twenty Twenty-Five does; renaming the theme's preset keeps both.`
	);
}

/** The active theme's presets, as WordPress resolves them, as site facts. */
export async function themePresetsFact( site: WordPressSite ): Promise< string[] > {
	const presets = await themePresets( site );
	return presets ? describePresets( presets ) : [];
}
