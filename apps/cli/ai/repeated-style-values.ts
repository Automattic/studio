/**
 * The raw style values block markup just written sets on several blocks, of
 * the kinds of value presets give. A block takes a preset by its slug,
 * as `"fontSize":"small"` or `var:preset|spacing|40`, which WordPress renders
 * as the preset's CSS variable (wp_typography_get_css_variable_inline_style()
 * in wp-includes/block-supports/typography.php, WP_Style_Engine in
 * wp-includes/style-engine/class-wp-style-engine.php): the editor offers it,
 * and Global Styles changes it for every block that uses it. The same raw
 * value on many blocks is one treatment kept in many places.
 *
 * Where the block validation gate saves the file through the editor, a raw
 * font size or spacing it repeats becomes a preset of its theme where nothing
 * can look different, and the save stores the blocks with it as the editor
 * stores a picked preset. A font size preset renders the same size, as both
 * go through wp_get_typography_font_size_value()
 * (wp-includes/block-supports/typography.php); a spacing size preset's CSS
 * variable holds its size as written (WP_Theme_JSON::PRESETS_METADATA gives
 * it no value_func). Other kinds of value are noted.
 */
import { readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { isBlockMarkupFile } from 'cli/ai/block-validation-gate';
import { readWordPressSite } from 'cli/ai/site-database';
import { isBlockMarkup, type SiteFile } from 'cli/ai/site-file-guards';
import { themePresets } from 'cli/ai/theme-presets';
import { isUpdatableTheme, readThemeHeader } from 'cli/ai/themes';

// The blocks set to one raw value before it reads as a shared treatment.
const REPEATED = 3;

type PresetKind = 'colors' | 'fontFamilies' | 'fontSizes' | 'spacingSizes';

// Each style a preset can give, by its path in a block's `style` attribute,
// and how a block takes the preset instead.
const STYLES: Array< { path: RegExp; kind: PresetKind; name: string; takes: string } > = [
	{
		path: /^typography\.fontSize$/,
		kind: 'fontSizes',
		name: 'Font size',
		takes: '"fontSize":"<slug>"',
	},
	{
		path: /^typography\.fontFamily$/,
		kind: 'fontFamilies',
		name: 'Font family',
		takes: '"fontFamily":"<slug>"',
	},
	{
		path: /^color\.(text|background)$/,
		kind: 'colors',
		name: 'Color',
		takes: '"textColor" or "backgroundColor":"<slug>"',
	},
	{
		path: /^spacing\.(blockGap|(padding|margin)\.(top|right|bottom|left))$/,
		kind: 'spacingSizes',
		name: 'Spacing size',
		takes: '"var:preset|spacing|<slug>"',
	},
];

const BLOCK_ATTRIBUTES = /<!--\s+wp:[a-z0-9-]+(?:\/[a-z0-9-]+)?\s+(\{.*?\})\s+\/?-->/g;

function leaves( value: unknown, at: string, out: Array< [ string, string ] > ): void {
	if ( value && typeof value === 'object' ) {
		for ( const [ key, child ] of Object.entries( value ) ) {
			leaves( child, at ? `${ at }.${ key }` : key, out );
		}
	} else if ( typeof value === 'string' || typeof value === 'number' ) {
		out.push( [ at, String( value ) ] );
	}
}

/** Each raw style value set on REPEATED or more blocks of the markup, with its count. */
export function repeatedStyleValues(
	markup: string
): Array< { path: string; value: string; blocks: number } > {
	const counts = new Map< string, { path: string; value: string; blocks: number } >();
	for ( const [ , json ] of markup.matchAll( BLOCK_ATTRIBUTES ) ) {
		let attributes: { style?: unknown };
		try {
			attributes = JSON.parse( json );
		} catch {
			continue;
		}
		const values: Array< [ string, string ] > = [];
		leaves( attributes.style, '', values );
		for ( const [ at, value ] of values ) {
			// A preset or variable is already shared, and zero needs no name.
			if ( value.startsWith( 'var' ) || /^0[a-z%]*$/.test( value ) ) {
				continue;
			}
			const key = `${ at } ${ value }`;
			const seen = counts.get( key ) ?? { path: at, value, blocks: 0 };
			seen.blocks++;
			counts.set( key, seen );
		}
	}
	return [ ...counts.values() ].filter( ( { blocks } ) => blocks >= REPEATED );
}

// A length a preset's slug can name, as `size-1-4-rem` names 1.4rem in the
// kebab case WordPress gives its class (_wp_to_kebab_case()).
const LENGTH = /^\d*\.?\d+(px|rem|em)$/;
const slugFor = ( size: string ) =>
	`size-${ size.replace( '.', '-' ).replace( /(\d)([a-z])/, '$1-$2' ) }`;

// Whether the theme's CSS sets a font size with !important, which the
// preset's class, printed with !important, would meet where an inline size
// gave way.
async function importantFontSize( themeDir: string, themeJson: unknown ): Promise< boolean > {
	const css = ( themeJson as { styles?: { css?: unknown } } )?.styles?.css;
	const files = ( await readdir( themeDir, { recursive: true } ) ).filter(
		( file ) => file.endsWith( '.css' ) && ! file.split( path.sep ).includes( 'node_modules' )
	);
	const sheets = [
		typeof css === 'string' ? css : '',
		...( await Promise.all(
			files.map( ( file ) => readFile( path.join( themeDir, file ), 'utf8' ) )
		) ),
	];
	return sheets.some( ( sheet ) => /font-size\s*:[^;}]*!\s*important/i.test( sheet ) );
}

// The kinds of value Studio makes a preset of, by where theme.json lists
// them, and whether the theme's CSS could make the preset look different.
const MADE: Partial<
	Record<
		PresetKind,
		{
			settings: [ string, string ];
			name: string;
			renders: string;
			differs: ( themeDir: string, themeJson: unknown ) => Promise< boolean >;
		}
	>
> = {
	fontSizes: {
		settings: [ 'typography', 'fontSizes' ],
		name: 'font size',
		renders:
			"Each renders the size it had (wp_get_typography_font_size_value() in wp-includes/block-supports/typography.php), and the editor's font size picker and Global Styles now offer and change it.",
		differs: importantFontSize,
	},
	spacingSizes: {
		settings: [ 'spacing', 'spacingSizes' ],
		name: 'spacing size',
		renders:
			"Each renders the value it had, which its CSS variable holds as written (WP_Theme_JSON::PRESETS_METADATA in wp-includes/class-wp-theme-json.php), and the editor's spacing controls and Global Styles now offer and change it.",
		differs: async () => false,
	},
};

/**
 * Adds each raw value in `values` to the file's theme as a preset of `kind`,
 * for the block validation gate's save through the editor to store the blocks
 * with them as, when that changes nothing the file renders. Returns the note
 * on what it added, and the values added.
 */
async function addPresets(
	siteFile: SiteFile,
	file: string,
	kind: PresetKind,
	values: string[],
	presets: Array< [ string, string ] >
): Promise< { note: string; added: string[] } | undefined > {
	const made = MADE[ kind ];
	const { siteRoot, theme } = siteFile;
	if ( ! made || ! theme || ( await isUpdatableTheme( siteRoot, theme.slug ) ) ) {
		return undefined;
	}
	const [ group, list ] = made.settings;
	const themeJsonFile = path.join( theme.dir, 'theme.json' );
	const themeJson = JSON.parse( await readFile( themeJsonFile, 'utf8' ) );
	const own = themeJson?.settings?.[ group ]?.[ list ];
	// A child theme's list replaces its parent's, so one is added to only where it is.
	const parent = await readThemeHeader( siteRoot, theme.slug, 'Template' ).catch( () => '' );
	if ( ( parent && ! Array.isArray( own ) ) || ( await made.differs( theme.dir, themeJson ) ) ) {
		return undefined;
	}
	const taken = new Set( presets.map( ( [ slug ] ) => slug ) );
	const added = [ ...new Set( values ) ]
		.filter( ( value ) => LENGTH.test( value ) && ! taken.has( slugFor( value ) ) )
		.map( ( value ): [ string, string ] => [ slugFor( value ), value ] );
	if ( ! added.length ) {
		return undefined;
	}
	themeJson.settings = {
		...themeJson.settings,
		[ group ]: {
			...themeJson.settings?.[ group ],
			[ list ]: [
				...( Array.isArray( own ) ? own : [] ),
				...added.map( ( [ slug, size ] ) => ( { name: size, slug, size } ) ),
			],
		},
	};
	await writeFile( themeJsonFile, JSON.stringify( themeJson, null, '\t' ) + '\n', 'utf8' );
	return {
		added: added.map( ( [ , value ] ) => value ),
		note: `Studio made the ${ made.name }s ${ file } repeats ${ made.name } presets of ${
			theme.slug
		}: it added ${ added
			.map( ( [ slug, value ] ) => `${ slug } (${ value })` )
			.join(
				', '
			) } to ${ themeJsonFile }'s "settings": { "${ group }": { "${ list }" } }, which Studio's save of the file through the block editor stores its blocks of those values as, as the editor stores a picked preset (Block validation reports it). ${
			made.renders
		} Each preset's "name" is its value; a name that says what it is for labels it in the editor.`,
	};
}

/** The raw values of a kind presets give that block markup just written repeats. */
export async function repeatedStyleValueNotes(
	siteFile: SiteFile,
	{ gateSaves = false }: { gateSaves?: boolean } = {}
): Promise< string[] > {
	if ( ! isBlockMarkup( siteFile ) ) {
		return [];
	}
	const file = path.join( siteFile.siteRoot, siteFile.relativePath );
	let repeated = repeatedStyleValues( await readFile( file, 'utf8' ) );
	if ( ! repeated.length ) {
		return [];
	}
	// The presets the file renders with: its theme's, or the active theme's.
	const presets = await readWordPressSite( siteFile.siteRoot, ( site ) =>
		themePresets( site, siteFile.theme?.slug )
	);
	if ( ! presets ) {
		return [];
	}
	// The block validation gate saves the file through the editor, which stores a
	// value a preset has as the preset (storePresetValues() in block-validator.ts).
	const saved = gateSaves && isBlockMarkupFile( file );
	const kindOf = ( at: string ) => STYLES.find( ( style ) => style.path.test( at ) )?.kind;
	const stored = ( { path: at, value }: { path: string; value: string } ) => {
		const kind = kindOf( at );
		return (
			( kind === 'fontSizes' || kind === 'spacingSizes' ) &&
			presets[ kind ].some( ( [ , size ] ) => size === value )
		);
	};
	repeated = repeated.filter( ( value ) => ! saved || ! stored( value ) );
	const made: Array< { note: string; added: string[]; kind: PresetKind } > = [];
	for ( const kind of saved ? ( Object.keys( MADE ) as PresetKind[] ) : [] ) {
		const values = repeated
			.filter( ( value ) => kindOf( value.path ) === kind )
			.map( ( { value } ) => value );
		const added = values.length
			? await addPresets( siteFile, file, kind, values, presets[ kind ] ).catch( () => undefined )
			: undefined;
		if ( added ) {
			made.push( { ...added, kind } );
		}
	}
	repeated = repeated.filter(
		( value ) =>
			! made.some(
				( { kind, added } ) => kindOf( value.path ) === kind && added.includes( value.value )
			)
	);
	const notes = made.map( ( { note } ) => note );
	const kinds = STYLES.map( ( style ) => ( {
		...style,
		values: repeated.filter( ( value ) => style.path.test( value.path ) ),
	} ) ).filter( ( style ) => style.values.length );
	if ( ! kinds.length ) {
		return notes;
	}
	const values = kinds
		.flatMap( ( style ) => style.values )
		.map( ( { path: at, value, blocks } ) => `${ at } ${ value } on ${ blocks }` );
	const offered = kinds.map(
		( style ) =>
			`${ style.name } presets (wp_get_global_settings()), taken as ${ style.takes }: ${
				presets[ style.kind ].map( ( [ slug, value ] ) => `${ slug } ${ value }` ).join( ', ' ) ||
				'none'
			}.`
	);
	return [
		`${ file } sets the same raw style values on several blocks: ${ values.join(
			', '
		) }. A block takes a preset by its slug, which WordPress renders as the preset's CSS variable (wp-includes/block-supports/typography.php, wp-includes/style-engine/class-wp-style-engine.php), so the editor offers it and Global Styles changes it on every block at once. ${ offered.join(
			' '
		) } Use the preset that fits, or add one to theme.json for a value the presets lack.`,
		...notes,
	];
}
