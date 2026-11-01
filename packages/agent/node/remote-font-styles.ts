/**
 * The stylesheets the site's front end loads from another host whose
 * @font-face rules have each visitor's browser download fonts from it. WordPress
 * serves a theme's fonts from the theme: the fontFace of each theme.json font
 * family, which wp_print_font_faces() prints as @font-face rules
 * (wp-includes/fonts.php), as Twenty Twenty-Five declares its fonts.
 *
 * WordPress itself says what loads: the enqueued styles of wp_enqueue_scripts
 * and their dependencies (wp_styles()), as the front end prints them.
 */
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import type { HostSite } from '@studio/agent/node/host';

/** By handle, the src of each style the front end loads from a host other than the site's. */
export type RemoteStyles = Record< string, string >;

export const REMOTE_STYLES = `
try {
	do_action( 'wp_enqueue_scripts' );
	$styles = wp_styles();
	$styles->all_deps( $styles->queue );
	$home   = wp_parse_url( home_url(), PHP_URL_HOST );
	$remote = array();
	foreach ( $styles->to_do as $handle ) {
		$src = $styles->registered[ $handle ]->src ?? '';
		if ( is_string( $src ) && preg_match( '#^(https?:)?//#', $src ) && wp_parse_url( $src, PHP_URL_HOST ) !== $home ) {
			$remote[ $handle ] = $src;
		}
	}
	echo 'REMOTE_STYLES=' . wp_json_encode( (object) $remote ) . "\\n";
	// The families whose files the site declares, which wp_print_font_faces() prints (wp-includes/fonts.php).
	$hosted = array();
	foreach ( (array) wp_get_global_settings( array( 'typography', 'fontFamilies' ) ) as $families ) {
		foreach ( (array) $families as $family ) {
			foreach ( (array) ( $family['fontFace'] ?? array() ) as $face ) {
				if ( ! empty( $face['fontFamily'] ) ) {
					$hosted[] = strtolower( trim( $face['fontFamily'], " '\\"" ) );
				}
			}
		}
	}
	echo 'HOSTED_FONTS=' . wp_json_encode( array_values( array_unique( $hosted ) ) ) . "\\n";
	echo 'ACTIVE_THEMES=' . wp_json_encode( array_values( array_unique( array( get_stylesheet(), get_template() ) ) ) ) . "\\n";
} catch ( Throwable $error ) {
	echo "REMOTE_STYLES={}\\n";
	echo "HOSTED_FONTS=[]\\n";
	echo "ACTIVE_THEMES=[]\\n";
}`;

// The hosts a stylesheet's @font-face rules download fonts from, and the families they declare.
async function fontFaces( src: string ): Promise< { hosts: string[]; families: string[] } > {
	const response = await fetch( src.startsWith( '//' ) ? `https:${ src }` : src );
	const css = response.ok ? await response.text() : '';
	const faces = css.match( /@font-face\s*\{[^}]*\}/g ) ?? [];
	const unique = ( values: string[] ) => [ ...new Set( values ) ].sort();
	return {
		hosts: unique(
			faces.flatMap( ( face ) =>
				[ ...face.matchAll( /url\(\s*['"]?(https?:\/\/[^/'")]+)/g ) ].map(
					( [ , origin ] ) => new URL( origin ).host
				)
			)
		),
		families: unique(
			faces.flatMap( ( face ) => {
				const family = face.match( /font-family:\s*['"]?([^;'"]+)/ )?.[ 1 ].trim();
				return family ? [ family ] : [];
			} )
		),
	};
}

// The theme file, site-relative, that names a style's handle as a quoted string.
async function fileNaming( site: HostSite, themes: string[], handle: string ) {
	const quoted = new RegExp( `['"]${ handle.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) }['"]` );
	for ( const theme of themes ) {
		const dir = path.join( site.path, 'wp-content/themes', theme );
		const files = await readdir( dir, { recursive: true } ).catch( () => [] as string[] );
		for ( const file of files.filter( ( name ) => name.endsWith( '.php' ) ).sort() ) {
			if ( quoted.test( await readFile( path.join( dir, file ), 'utf8' ).catch( () => '' ) ) ) {
				return `wp-content/themes/${ theme }/${ file.split( path.sep ).join( '/' ) }`;
			}
		}
	}
	return undefined;
}

const list = ( names: string[] ) =>
	names.length < 2
		? names.join( '' )
		: `${ names.slice( 0, -1 ).join( ', ' ) } and ${ names.at( -1 ) }`;

/**
 * What the front end newly loads from another host's fonts: when the site
 * already declares those families' files, that each visitor downloads them
 * twice; otherwise how WordPress serves a theme's fonts.
 */
export async function describeRemoteFonts(
	site: HostSite,
	before: RemoteStyles,
	now: RemoteStyles,
	hosted: string[] = [],
	themes: string[] = []
): Promise< string | undefined > {
	const added = Object.entries( now ).filter( ( [ handle, src ] ) => before[ handle ] !== src );
	const loaded = (
		await Promise.all(
			added.map( async ( [ handle, src ] ) => ( {
				handle,
				src,
				...( await fontFaces( src ).catch( () => ( { hosts: [], families: [] } ) ) ),
			} ) )
		)
	).filter( ( { hosts } ) => hosts.length );
	if ( ! loaded.length ) {
		return undefined;
	}
	const isHosted = ( family: string ) => hosted.includes( family.toLowerCase() );
	const twice = loaded.filter( ( { families } ) => families.length && families.every( isHosted ) );
	const notes = await Promise.all(
		twice.map( async ( { handle, src, hosts, families } ) => {
			const file = await fileNaming( site, themes, handle );
			return `${ site.name }: the front end loads ${ src } (handle ${ handle }${
				file ? `, in ${ file }` : ''
			}), which has each visitor's browser download ${ list( families ) } from ${ hosts.join(
				', '
			) }. theme.json already declares ${
				families.length > 1 ? "those families' files" : 'its files'
			} in the site, which WordPress prints as @font-face rules (wp_print_font_faces() in wp-includes/fonts.php), so each visitor downloads ${
				families.length > 1 ? 'these fonts' : 'this font'
			} twice. The site serves ${ families.length > 1 ? 'them' : 'it' } without this stylesheet.`;
		} )
	);
	const rest = loaded.filter( ( style ) => ! twice.includes( style ) );
	if ( rest.length ) {
		notes.push(
			`${ site.name }: the front end loads ${ rest
				.map(
					( { handle, src, hosts } ) =>
						`${ src } (handle ${ handle }), from ${ hosts.join( ', ' ) }`
				)
				.join(
					'; '
				) }, whose @font-face rules have each visitor's browser download the fonts from that host (wp_enqueue_style() on wp_enqueue_scripts). WordPress serves a theme's fonts from the theme: the fontFace of each font family in its theme.json settings.typography.fontFamilies, whose "file:./" sources wp_print_font_faces() prints as @font-face rules (wp-includes/fonts.php), as Twenty Twenty-Five declares its fonts. Studio downloads into the theme the Google Fonts files of a family declared there without fontFace.`
		);
	}
	return notes.join( '\n' );
}
