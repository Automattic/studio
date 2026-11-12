/**
 * What WordPress keeps of a theme JSON file just written: theme.json, or a
 * style variation in the theme's styles directory. WordPress reads each as
 * ( new WP_Theme_JSON( $decoded ) )->get_raw_data()
 * (WP_Theme_JSON_Resolver::get_theme_data and get_style_variations in
 * wp-includes/class-wp-theme-json-resolver.php), which migrates the file to
 * the current schema and removes what the schema has no place for. Studio
 * runs that same read on the site, and says which keys it removed, or what
 * the read threw: in the climbing-gym eval case a "spacingScale" of 1.4,
 * which WordPress reads as an array, failed every page. Of a style
 * variation of the active theme, it says what WordPress lists it as.
 */
import fs from 'fs';
import { jsonSyntaxError } from '@studio/agent/node/json-syntax';
import { boundedText } from '@studio/agent/shared/bounded-list';
import { printedJson, wpEval } from '@studio/agent/shared/tools/utils';
import type { OpenProblems } from '@studio/agent/node/open-problems';
import type { SiteFile } from '@studio/agent/node/site-file';
import type { HostSite, StudioAgentHost } from '@studio/agent/shared/host';

// WP_Theme_JSON::__construct's own steps up to sanitize, which removes what
// the schema has no place for. What goes into sanitize, against what comes
// out, is what it removed; the steps after it only expand and key by origin.
// Sanitize also removes a key the schema has once all under it is removed, as
// an element whose "color" is a string rather than { "text": … }; the schema
// sanitize builds, which it hands to remove_keys_not_in_schema for "styles"
// and "settings", says which key under it is the one with no place.
// The kinds of preset a style names, by the settings that define them and the
// field each preset's value is in.
const PRESET_KINDS_PHP = `array(
		'color'       => array( 'color', 'palette', 'color' ),
		'gradient'    => array( 'color', 'gradients', 'gradient' ),
		'font-size'   => array( 'typography', 'fontSizes', 'size' ),
		'font-family' => array( 'typography', 'fontFamilies', 'fontFamily' ),
		'spacing'     => array( 'spacing', 'spacingSizes', 'size' ),
		'shadow'      => array( 'shadow', 'presets', 'shadow' ),
	)`;

const READ = ( file: string ) => `
$decoded = wp_json_file_decode( ${ JSON.stringify( file ) }, array( 'associative' => true ) );
$dropped = array();
$fails   = null;
// The whole read, as WordPress makes it of the theme's file on each request:
// what it throws, every page the theme renders throws.
if ( is_array( $decoded ) ) {
	try {
		new WP_Theme_JSON( $decoded, 'theme' );
	} catch ( Throwable $thrown ) {
		$fails = get_class( $thrown ) . ': ' . $thrown->getMessage() . ' in ' . preg_replace( '#^.*?/(?=wp-(?:includes|admin|content)/)#', '', wp_normalize_path( $thrown->getFile() ) ) . ':' . $thrown->getLine();
	}
}
if ( is_array( $decoded ) && null === $fails ) {
	// Resolving the theme's data registers its block styles, as before WordPress reads its files.
	WP_Theme_JSON_Resolver::get_theme_data();
	// WP_Theme_JSON as it is, but for keeping the schema sanitize builds.
	$probe = new class() extends WP_Theme_JSON {
		public static $schemas = array();
		public function __construct() {}
		protected static function remove_keys_not_in_schema( $tree, $schema ) {
			static::$schemas[] = array( $tree, $schema );
			return parent::remove_keys_not_in_schema( $tree, $schema );
		}
	};
	$steps = Closure::bind(
		static function ( $theme_json, $probe ) {
			$migrated   = WP_Theme_JSON_Schema::migrate( $theme_json, 'theme' );
			$metadata   = static::get_blocks_metadata();
			$variations = static::get_valid_block_style_variations( $metadata );
			$unwrapped  = static::unwrap_shared_block_style_variations( $migrated, $variations );
			return array( $unwrapped, $probe::sanitize( $unwrapped, array_keys( $metadata ), array_keys( static::ELEMENTS ), $variations ) );
		},
		null,
		WP_Theme_JSON::class
	);
	list( $before, $kept ) = $steps( $decoded, get_class( $probe ) );
	$schema = array();
	foreach ( $probe::$schemas as list( $tree, $subtree_schema ) ) {
		foreach ( array( 'styles', 'settings' ) as $subtree ) {
			if ( isset( $before[ $subtree ] ) && $tree === $before[ $subtree ] ) {
				$schema[ $subtree ] = $subtree_schema;
			}
		}
	}
	if ( ! isset( $decoded['version'] ) ) {
		// Migrate removes it all, whatever the schema has a place for.
		$before = $decoded;
		$schema = null;
	}
	// "$schema" is for the editor that writes the file, as in Twenty Twenty-Five's.
	unset( $before['$schema'] );
	// The deepest key written that WordPress removes: under a key the schema
	// has, removed only for having nothing kept under it, the keys under it.
	$walk = function ( $written, $kept, $schema, $prefix ) use ( &$walk, &$dropped ) {
		foreach ( $written as $key => $value ) {
			$at = '' === $prefix ? (string) $key : $prefix . '.' . $key;
			if ( array() === $value ) {
				continue;
			}
			$in_schema = is_array( $schema ) && array_key_exists( $key, $schema ) ? $schema[ $key ] : null;
			if ( is_array( $kept ) && array_key_exists( $key, $kept ) ) {
				if ( is_array( $value ) ) {
					$walk( $value, $kept[ $key ], $in_schema, $at );
				}
			} elseif ( is_array( $in_schema ) && is_array( $value ) && ! wp_is_numeric_array( $value ) ) {
				$walk( $value, array(), $in_schema, $at );
			} else {
				$dropped[] = $at;
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
	$walk( $before, $kept, $schema, '' );
}
// The active theme's style variation, as the Site Editor's Styles lists it:
// the entry WP_Theme_JSON_Resolver::get_style_variations() builds from this file.
$listed = null;
if ( is_array( $decoded ) && null === $fails && 0 === strpos( wp_normalize_path( ${ JSON.stringify(
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
// The presets the site resolves, by kind, slug and value, as its own or
// active parent's theme.json is read: WordPress prints a CSS variable for
// each (WP_Theme_JSON::compute_preset_vars()), named by the kebab-case slug.
$presets = null;
if ( is_array( $decoded ) && null === $fails && in_array( wp_normalize_path( ${ JSON.stringify(
	file
) } ), array( wp_normalize_path( get_stylesheet_directory() . '/theme.json' ), wp_normalize_path( get_template_directory() . '/theme.json' ) ), true ) ) {
	$presets = array();
	foreach ( ${ PRESET_KINDS_PHP } as $kind => list( $group, $key, $field ) ) {
		$presets[ $kind ] = array();
		foreach ( (array) wp_get_global_settings( array( $group, $key ) ) as $origin ) {
			foreach ( (array) $origin as $preset ) {
				if ( isset( $preset['slug'] ) ) {
					$presets[ $kind ][ _wp_to_kebab_case( $preset['slug'] ) ] = is_string( $preset[ $field ] ?? null ) ? $preset[ $field ] : '';
				}
			}
		}
	}
}
echo 'THEME_JSON_READ=' . wp_json_encode( array( 'decoded' => is_array( $decoded ), 'error' => json_last_error_msg(), 'version' => isset( $decoded['version'] ), 'latest' => WP_Theme_JSON::LATEST_SCHEMA, 'dropped' => $dropped, 'fails' => $fails, 'listed' => $listed, 'presets' => $presets ) );`;

interface Read {
	decoded: boolean;
	error: string;
	version: boolean;
	latest: number;
	dropped: string[];
	fails: string | null;
	listed: {
		title: string;
		theme: string;
		palette: string[];
		colors: Record< string, string >;
	} | null;
	presets: Record< string, Record< string, string > > | null;
}

// A preset a style names, as theme.json writes it (WP_Theme_JSON::convert_custom_properties()) or as CSS.
const PRESET_REFERENCE =
	/var:preset\|([a-z-]+)\|([^|"]+)|var\(\s*--wp--preset--(color|gradient|font-size|font-family|spacing|shadow)--([a-z0-9-]+)\s*\)/g;

/**
 * The styles of the theme.json just written that name a preset the site does
 * not have. WordPress prints the reference as the preset's CSS variable
 * (WP_Theme_JSON::get_property_value()) and defines a variable only for the
 * presets it resolves (compute_preset_vars()), so the browser drops the
 * declaration: a background shows none, a text color is inherited. In eval38
 * taqueria port 1 the buttons' "chile" was a color the palette did not have,
 * and their text sat on the cream page at 1.1:1.
 */
function unknownPresetsNote( read: Read, relativePath: string, text: string ): string | undefined {
	const { presets } = read;
	let styles: unknown;
	try {
		styles = ( JSON.parse( text ) as { styles?: unknown } ).styles;
	} catch {
		return undefined;
	}
	if ( ! presets || ! styles ) {
		return undefined;
	}
	const named: string[] = [];
	const kinds = new Set< string >();
	const walk = ( value: unknown, at: string ) => {
		if ( typeof value === 'string' ) {
			for ( const [ , kind = '', slug = '', cssKind, cssSlug ] of value.matchAll(
				PRESET_REFERENCE
			) ) {
				const [ k, s ] = cssKind ? [ cssKind, cssSlug ] : [ kind, slug ];
				if ( presets[ k ] && ! ( s in presets[ k ] ) ) {
					named.push( `${ at } ${ k } ${ s }` );
					kinds.add( k );
				}
			}
		} else if ( value && typeof value === 'object' ) {
			for ( const [ key, child ] of Object.entries( value ) ) {
				walk( child, `${ at }.${ key }` );
			}
		}
	};
	walk( styles, 'styles' );
	if ( ! named.length ) {
		return undefined;
	}
	return [
		`${ relativePath } names presets the site does not have, so WordPress prints a CSS variable no rule defines and the browser drops the declaration: a background shows none, a text color is inherited (get_property_value() and compute_preset_vars() in wp-includes/class-wp-theme-json.php): ${ boundedText(
			named,
			SHOWN
		) }.`,
		...[ ...kinds ].map(
			( kind ) =>
				`The site's ${ kind } presets (wp_get_global_settings()): ${ boundedText(
					Object.entries( presets[ kind ] ).map( ( [ slug, value ] ) => `${ slug } ${ value }` ),
					SHOWN * 2
				) }.`
		),
	].join( '\n' );
}

const SHOWN = 12;

/**
 * What WordPress makes of a theme JSON file, as notes: the keys it removes,
 * and the style variation it lists the file as. The problem is what keeps
 * the file from reaching the site as written: JSON WordPress cannot decode,
 * or keys it removes.
 */
export async function themeJsonFileRead(
	host: StudioAgentHost,
	site: HostSite,
	file: string,
	relativePath: string
): Promise< { problem?: string; notes: string[] } > {
	const output = await wpEval( host, site, READ( file ) );
	const read = printedJson< Read >( output, 'THEME_JSON_READ=' );
	const problem = ! read.decoded
		? decodeProblem( relativePath, read.error, syntaxAt( file ) )
		: read.fails
		? `WordPress fails reading ${ relativePath } as new WP_Theme_JSON( $decoded ) (WP_Theme_JSON_Resolver in wp-includes/class-wp-theme-json-resolver.php): ${ read.fails }. Each page the theme renders fails the same way while it is active. A value of the wrong form does this: the schema gives each setting and style its form (https://schemas.wp.org/trunk/theme.json), as Twenty Twenty-Five's theme.json writes them.`
		: dropNote( read, relativePath );
	const listed = read.decoded ? listedNote( read ) : undefined;
	const unknown = read.decoded
		? unknownPresetsNote( read, relativePath, readText( file ) ?? '' )
		: undefined;
	return {
		problem,
		notes: [ problem, listed, unknown ].filter( ( note ): note is string => !! note ),
	};
}

function decodeProblem( relativePath: string, error: string, at: string ): string {
	return `WordPress cannot decode ${ relativePath } as JSON (wp_json_file_decode in wp-includes/functions.php): ${ error }. It reads nothing from it until the file is valid JSON.${ at }`;
}

function readText( file: string ): string | undefined {
	try {
		return fs.readFileSync( file, 'utf8' );
	} catch {
		return undefined;
	}
}

// Where the file stops parsing, which json_decode's error does not say.
function syntaxAt( file: string ): string {
	const text = readText( file );
	return text === undefined ? '' : syntaxAtText( text );
}

function syntaxAtText( text: string ): string {
	const error = jsonSyntaxError( text );
	return error
		? ` JSON parsing stops at line ${ error.line }, column ${ error.column } (${ error.reason }): \`${ error.excerpt }\`.`
		: '';
}

const THEME_JSON_FILE = /^(theme\.json|styles\/.+\.json)$/;

// json_decode's error for text JSON.parse cannot read either: an unescaped
// control character in a string, or else a syntax error (json_last_error_msg()).
function phpDecodeError( text: string ): string | undefined {
	try {
		JSON.parse( text );
		return undefined;
	} catch ( error ) {
		return /control character/i.test( error instanceof Error ? error.message : String( error ) )
			? 'Control character error, possibly incorrectly encoded'
			: 'Syntax error';
	}
}

/**
 * A fix-time source: a theme JSON file just written that is not JSON, said on
 * the result of the call that wrote it. Read on the site, as
 * themeJsonFileNotes does, the note came with the next call's result: in the
 * eval29 picky case, after the model had read the result of the Write that
 * broke theme.json, and it spent nine calls on a theme WordPress read nothing
 * of. JSON.parse rejects what json_decode rejects, short of malformed UTF-8,
 * which the read on the site still finds.
 */
export function themeJsonSyntaxNotes( siteFile: SiteFile, open?: OpenProblems ): string[] {
	const { theme, siteRoot, relativePath } = siteFile;
	if ( ! theme || ! THEME_JSON_FILE.test( theme.file ) ) {
		return [];
	}
	const file = `${ siteRoot }/${ relativePath }`;
	const text = readText( file );
	if ( text === undefined ) {
		return [];
	}
	const error = phpDecodeError( text );
	const problem = error && decodeProblem( relativePath, error, syntaxAtText( text ) );
	open?.record( siteRoot, file, problem );
	return problem ? [ problem ] : [];
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
	const shown = boundedText( read.dropped, SHOWN );
	return read.version
		? `WordPress reads ${ relativePath } as ( new WP_Theme_JSON( $decoded ) )->get_raw_data() (WP_Theme_JSON_Resolver in wp-includes/class-wp-theme-json-resolver.php), which removes the keys the theme.json schema has no place for (WP_Theme_JSON's VALID_TOP_LEVEL_KEYS, VALID_SETTINGS and VALID_STYLES, and its block and element names, in wp-includes/class-wp-theme-json.php), so these change nothing on the site: ${ shown }. The schema gives each setting and style its form (https://schemas.wp.org/trunk/theme.json), as Twenty Twenty-Five's theme.json writes them.`
		: `${ relativePath } has no "version", so WordPress keeps only { "version": ${ read.latest } } of it (WP_Theme_JSON_Schema::migrate in wp-includes/class-wp-theme-json-schema.php, which WP_Theme_JSON runs on each theme JSON file it reads), and none of these reach the site: ${ shown }. It reads them all with "version": ${ read.latest }, as Twenty Twenty-Five's theme JSON files have.`;
}

/**
 * A site-notes write source: the keys WordPress removes from a theme JSON
 * file just written. What keeps the file from reaching the site stays open
 * until a later write resolves it, so the turn does not end on a look
 * WordPress never applies, as a theme.json whose fonts sat outside
 * "typography" did in the climbing-gym eval case.
 */
export async function themeJsonFileNotes(
	host: StudioAgentHost,
	siteFile: SiteFile,
	open?: OpenProblems
): Promise< string[] > {
	const { theme, siteRoot, relativePath } = siteFile;
	if ( ! theme || ! THEME_JSON_FILE.test( theme.file ) ) {
		return [];
	}
	const file = `${ siteRoot }/${ relativePath }`;
	// Text that is not JSON was said, and recorded open, on the call's own
	// result (themeJsonSyntaxNotes).
	const text = readText( file );
	if ( text === undefined || phpDecodeError( text ) ) {
		return [];
	}
	const site = await host.sites.resolve( siteRoot );
	const { problem, notes } = await themeJsonFileRead( host, site, file, relativePath );
	open?.record( siteRoot, file, problem );
	return notes;
}
