/**
 * The presets a site's blocks and styles use, as WordPress resolves them:
 * wp_get_global_settings() merges core's theme.json, the parent and child
 * themes' and the user's Global Styles (WP_Theme_JSON_Resolver), the same data
 * the editor shows. Each preset is named by the slug a block attribute or a
 * `var(--wp--preset--…)` takes.
 *
 * Resolving them runs WordPress, so they are resolved again only when what
 * they are resolved from changes: the active themes' files, the user's Global
 * Styles, the active plugins (which can filter theme.json) and WordPress.
 */
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { resolveSite } from 'cli/ai/tools/utils';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import type { WordPressSite } from 'cli/ai/site-database';

interface Presets {
	colors: Array< [ string, string ] >;
	fontFamilies: Array< [ string, string ] >;
	fontSizes: Array< [ string, string ] >;
	spacingSizes: Array< [ string, string ] >;
	layout: { contentSize?: string; wideSize?: string };
}

// The presets of each origin the editor offers, in WordPress's order: core's
// unless the theme turns them off, then the theme's, then the user's.
const RESOLVE = `
$settings = wp_get_global_settings();
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
) );
`;

const resolved = new Map< string, { inputs: string; lines: Promise< string[] > } >();

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

async function resolve( root: string ): Promise< Presets > {
	const site = await resolveSite( root );
	try {
		await connectToDaemon();
		await using command = await runWpCliCommand( site, [ 'eval', RESOLVE ] );
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
	].filter( ( line ): line is string => Boolean( line ) );
}

/** The active theme's presets, as WordPress resolves them, as site facts. */
export async function themePresetsFact( site: WordPressSite ): Promise< string[] > {
	const themes = [
		...new Set( [ site.option( 'stylesheet' ), site.option( 'template' ) ] ),
	].filter( ( theme ): theme is string => typeof theme === 'string' && theme !== '' );
	if ( ! themes.length ) {
		return [];
	}
	const inputs = await inputsOf( site, themes );
	let entry = resolved.get( site.root );
	if ( entry?.inputs !== inputs ) {
		entry = {
			inputs,
			lines: resolve( site.root ).then( describePresets ),
		};
		resolved.set( site.root, entry );
		// A site WordPress could not run for states no presets, and is asked again next time.
		entry.lines.catch( () => resolved.delete( site.root ) );
	}
	return entry.lines.catch( () => [] );
}
