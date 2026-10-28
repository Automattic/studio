/**
 * What WordPress keeps of a theme JSON file just written: theme.json, or a
 * style variation in the theme's styles directory. WordPress reads each as
 * ( new WP_Theme_JSON( $decoded ) )->get_raw_data()
 * (WP_Theme_JSON_Resolver::get_theme_data and get_style_variations in
 * wp-includes/class-wp-theme-json-resolver.php), which migrates the file to
 * the current schema and removes what the schema has no place for. Studio
 * runs that same read on the site, and says which keys it removed. Of a style
 * variation of the active theme, it says what WordPress lists it as.
 */
import { runWpCli } from '@studio/agent/node/tools/utils';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { SiteFile } from '@studio/agent/node/site-file-guards';

// WP_Theme_JSON::__construct's own steps up to sanitize, which removes what
// the schema has no place for. What goes into sanitize, against what comes
// out, is what it removed; the steps after it only expand and key by origin.
const READ = ( file: string ) => `
$decoded = wp_json_file_decode( ${ JSON.stringify( file ) }, array( 'associative' => true ) );
$dropped = array();
if ( is_array( $decoded ) ) {
	// Resolving the theme's data registers its block styles, as before WordPress reads its files.
	WP_Theme_JSON_Resolver::get_theme_data();
	$steps = Closure::bind(
		static function ( $theme_json ) {
			$migrated   = WP_Theme_JSON_Schema::migrate( $theme_json, 'theme' );
			$metadata   = static::get_blocks_metadata();
			$variations = static::get_valid_block_style_variations( $metadata );
			$unwrapped  = static::unwrap_shared_block_style_variations( $migrated, $variations );
			return array( $unwrapped, static::sanitize( $unwrapped, array_keys( $metadata ), array_keys( static::ELEMENTS ), $variations ) );
		},
		null,
		WP_Theme_JSON::class
	);
	list( $before, $kept ) = $steps( $decoded );
	if ( ! isset( $decoded['version'] ) ) {
		$before = $decoded;
	}
	// "$schema" is for the editor that writes the file, as in Twenty Twenty-Five's.
	unset( $before['$schema'] );
	$walk = function ( $written, $kept, $prefix ) use ( &$walk, &$dropped ) {
		foreach ( $written as $key => $value ) {
			$at = '' === $prefix ? (string) $key : $prefix . '.' . $key;
			if ( array() === $value ) {
				continue;
			}
			if ( ! is_array( $kept ) || ! array_key_exists( $key, $kept ) ) {
				$dropped[] = $at;
			} elseif ( is_array( $value ) ) {
				$walk( $value, $kept[ $key ], $at );
			}
		}
	};
	// Shared variations move to the blocks that have them registered, and the rest are removed.
	foreach ( array_keys( (array) ( $decoded['styles']['variations'] ?? array() ) ) as $name ) {
		$moved = false;
		foreach ( (array) ( $kept['styles']['blocks'] ?? array() ) as $block ) {
			$moved = $moved || isset( $block['variations'][ $name ] );
		}
		if ( ! $moved && isset( $decoded['version'] ) ) {
			$dropped[] = 'styles.variations.' . $name;
		}
	}
	$walk( $before, $kept, '' );
}
// The active theme's style variation, as the Site Editor's Styles lists it:
// the entry WP_Theme_JSON_Resolver::get_style_variations() builds from this file.
$listed = null;
if ( is_array( $decoded ) && 0 === strpos( wp_normalize_path( ${ JSON.stringify(
	file
) } ), wp_normalize_path( get_stylesheet_directory() . '/styles/' ) ) ) {
	$own = Closure::bind(
		static fn( $decoded ) => ( new WP_Theme_JSON( static::translate( $decoded, wp_get_theme()->get( 'TextDomain' ) ) ) )->get_raw_data(),
		null,
		WP_Theme_JSON_Resolver::class
	)( $decoded );
	if ( empty( $own['title'] ) ) {
		$own['title'] = basename( ${ JSON.stringify( file ) }, '.json' );
	}
	$variations = WP_Theme_JSON_Resolver::get_style_variations();
	if ( in_array( $own, $variations, true ) ) {
		$listed = array(
			'title'     => $own['title'],
			'theme'     => wp_get_theme()->get( 'Name' ),
			'palette'   => array_map( fn( $c ) => $c['slug'] . ' ' . $c['color'], $own['settings']['color']['palette']['theme'] ?? array() ),
			'colors'    => array_filter( array( 'background' => $own['styles']['color']['background'] ?? null, 'text' => $own['styles']['color']['text'] ?? null ) ),
		);
	}
}
echo 'THEME_JSON_READ=' . wp_json_encode( array( 'decoded' => is_array( $decoded ), 'error' => json_last_error_msg(), 'version' => isset( $decoded['version'] ), 'latest' => WP_Theme_JSON::LATEST_SCHEMA, 'dropped' => $dropped, 'listed' => $listed ) );`;

interface Read {
	decoded: boolean;
	error: string;
	version: boolean;
	latest: number;
	dropped: string[];
	listed: {
		title: string;
		theme: string;
		palette: string[];
		colors: Record< string, string >;
	} | null;
}

const SHOWN = 12;

/**
 * What WordPress makes of a theme JSON file, as notes: the keys it removes,
 * and the style variation it lists the file as.
 */
export async function themeJsonFileRead(
	host: StudioAgentHost,
	site: HostSite,
	file: string,
	relativePath: string
): Promise< string[] > {
	const output = await runWpCli( host, site, [ 'eval', READ( file ) ] );
	const read = JSON.parse(
		output.slice( output.indexOf( 'THEME_JSON_READ=' ) + 'THEME_JSON_READ='.length )
	) as Read;
	if ( ! read.decoded ) {
		return [
			`WordPress cannot decode ${ relativePath } as JSON (wp_json_file_decode in wp-includes/functions.php): ${ read.error }. It reads nothing from it until the file is valid JSON.`,
		];
	}
	return [ dropNote( read, relativePath ), listedNote( read ) ].filter(
		( note ): note is string => !! note
	);
}

function listedNote( { listed }: Read ): string | undefined {
	if ( ! listed ) {
		return undefined;
	}
	const reads = [
		...( listed.palette.length ? [ `palette ${ listed.palette.join( ', ' ) }` ] : [] ),
		...Object.entries( listed.colors ).map( ( [ key, value ] ) => `${ key } ${ value }` ),
	];
	return `WordPress lists "${ listed.title }" among ${
		listed.theme
	}'s style variations (WP_Theme_JSON_Resolver::get_style_variations() in wp-includes/class-wp-theme-json-resolver.php)${
		reads.length ? `: ${ reads.join( '; ' ) }` : ''
	}. The user switches to it in the Site Editor's Styles, which saves it as the site's Global Styles.`;
}

function dropNote( read: Read, relativePath: string ): string | undefined {
	if ( ! read.dropped.length ) {
		return undefined;
	}
	const shown = read.dropped.slice( 0, SHOWN ).join( ', ' );
	const more = read.dropped.length > SHOWN ? `, and ${ read.dropped.length - SHOWN } more` : '';
	return read.version
		? `WordPress reads ${ relativePath } as ( new WP_Theme_JSON( $decoded ) )->get_raw_data() (WP_Theme_JSON_Resolver in wp-includes/class-wp-theme-json-resolver.php), which removes the keys the theme.json schema has no place for (WP_Theme_JSON's VALID_TOP_LEVEL_KEYS, VALID_SETTINGS and VALID_STYLES, and its block and element names, in wp-includes/class-wp-theme-json.php), so these change nothing on the site: ${ shown }${ more }. The schema gives each setting and style its form (https://schemas.wp.org/trunk/theme.json), as Twenty Twenty-Five's theme.json writes them.`
		: `${ relativePath } has no "version", so WordPress keeps only { "version": ${ read.latest } } of it (WP_Theme_JSON_Schema::migrate in wp-includes/class-wp-theme-json-schema.php, which WP_Theme_JSON runs on each theme JSON file it reads), and none of these reach the site: ${ shown }${ more }. It reads them all with "version": ${ read.latest }, as Twenty Twenty-Five's theme JSON files have.`;
}

/** A site-notes write source: the keys WordPress removes from a theme JSON file just written. */
export async function themeJsonFileNotes(
	host: StudioAgentHost,
	siteFile: SiteFile
): Promise< string[] > {
	const { theme, siteRoot, relativePath } = siteFile;
	if ( ! theme || ! /^(theme\.json|styles\/.+\.json)$/.test( theme.file ) ) {
		return [];
	}
	const site = await host.sites.resolve( siteRoot );
	return themeJsonFileRead( host, site, `${ siteRoot }/${ relativePath }`, relativePath );
}
