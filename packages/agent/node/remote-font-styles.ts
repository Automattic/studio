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
} catch ( Throwable $error ) {
	echo "REMOTE_STYLES={}\\n";
}`;

// The hosts a stylesheet's @font-face rules download fonts from, or none when it has none.
async function fontHosts( src: string ): Promise< string[] > {
	const response = await fetch( src.startsWith( '//' ) ? `https:${ src }` : src );
	const css = response.ok ? await response.text() : '';
	const faces = css.match( /@font-face\s*\{[^}]*\}/g ) ?? [];
	return [
		...new Set(
			faces.flatMap( ( face ) =>
				[ ...face.matchAll( /url\(\s*['"]?(https?:\/\/[^/'")]+)/g ) ].map(
					( [ , origin ] ) => new URL( origin ).host
				)
			)
		),
	].sort();
}

/** What the front end newly loads from another host's fonts, with how WordPress serves a theme's fonts. */
export async function describeRemoteFonts(
	site: HostSite,
	before: RemoteStyles,
	now: RemoteStyles
): Promise< string | undefined > {
	const added = Object.entries( now ).filter( ( [ handle, src ] ) => before[ handle ] !== src );
	const fonts = (
		await Promise.all(
			added.map( async ( [ handle, src ] ) => {
				const hosts = await fontHosts( src ).catch( () => [] );
				return hosts.length ? `${ src } (handle ${ handle }), from ${ hosts.join( ', ' ) }` : '';
			} )
		)
	).filter( Boolean );
	if ( ! fonts.length ) {
		return undefined;
	}
	return `${ site.name }: the front end loads ${ fonts.join(
		'; '
	) }, whose @font-face rules have each visitor's browser download the fonts from that host (wp_enqueue_style() on wp_enqueue_scripts). WordPress serves a theme's fonts from the theme: the fontFace of each font family in its theme.json settings.typography.fontFamilies, whose "file:./" sources wp_print_font_faces() prints as @font-face rules (wp-includes/fonts.php), as Twenty Twenty-Five declares its fonts. Studio downloads into the theme the Google Fonts files of a family declared there without fontFace.`;
}
