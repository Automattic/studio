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
import {
	blockEditorOf,
	isBlockMarkupFile,
	sitePresetValues,
	validateBlockMarkup,
	validateBlockMarkupFile,
} from '@studio/agent/node/block-validation-gate';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { isBlockMarkup, type SiteFile } from '@studio/agent/node/site-file-guards';
import { placeOf, saveMarkup, siteMarkup, type Markup } from '@studio/agent/node/site-markup';
import { themePresets } from '@studio/agent/node/theme-presets';
import { isUpdatableTheme, readThemeHeader } from '@studio/agent/node/themes';
import type { StudioAgentHost } from '@studio/agent/node/host';

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

/** Each raw style value a block of the markup sets, by its path in `style`. */
function rawStyleValues( markup: string ): Array< [ string, string ] > {
	const raw: Array< [ string, string ] > = [];
	for ( const [ , json ] of markup.matchAll( BLOCK_ATTRIBUTES ) ) {
		let attributes: { style?: unknown };
		try {
			attributes = JSON.parse( json );
		} catch {
			continue;
		}
		const values: Array< [ string, string ] > = [];
		leaves( attributes.style, '', values );
		// A preset or variable is already shared, and zero needs no name.
		raw.push(
			...values.filter(
				( [ , value ] ) => ! value.startsWith( 'var' ) && ! /^0[a-z%]*$/.test( value )
			)
		);
	}
	return raw;
}

/**
 * Each raw style value the markup sets that REPEATED or more blocks set, in it
 * and in `others`, the rest of the markup the site renders with it: a preset
 * is the site's, so the blocks that share a value are counted where they are.
 */
export function repeatedStyleValues(
	markup: string,
	others: string[] = []
): Array< { path: string; value: string; blocks: number } > {
	const counts = new Map< string, { path: string; value: string; blocks: number } >();
	for ( const source of [ markup, ...others ] ) {
		for ( const [ at, value ] of rawStyleValues( source ) ) {
			const key = `${ at } ${ value }`;
			const seen = counts.get( key ) ?? { path: at, value, blocks: 0 };
			seen.blocks++;
			counts.set( key, seen );
		}
	}
	const own = new Set( rawStyleValues( markup ).map( ( [ at, value ] ) => `${ at } ${ value }` ) );
	return [ ...counts.entries() ]
		.filter( ( [ key, { blocks } ] ) => own.has( key ) && blocks >= REPEATED )
		.map( ( [ , seen ] ) => seen );
}

// Each attribute a block takes a preset's look by, and where a block style's
// "styles" hold it, as the editor's own controls store it (the color, border
// and typography supports in wp-includes/block-supports/).
const PRESET_ATTRIBUTES: Record< string, [ string, string, string ] > = {
	backgroundColor: [ 'color', 'background', 'color' ],
	textColor: [ 'color', 'text', 'color' ],
	gradient: [ 'color', 'gradient', 'gradient' ],
	borderColor: [ 'border', 'color', 'color' ],
	fontSize: [ 'typography', 'fontSize', 'font-size' ],
	fontFamily: [ 'typography', 'fontFamily', 'font-family' ],
};

// The styles presets give: colors, font sizes and families, and spacing.
const PRESET_GIVES = /^(color\.|typography\.font(Size|Family)$|spacing\.)/;

const NAMED_BLOCK = /<!--\s+wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)\s+(\{.*?\})\s+\/?-->/g;

/**
 * Each look REPEATED or more blocks of one type in the markup share whole:
 * their `style` and preset attributes, as the "styles" of a block style, which
 * holds a look blocks of one type share. A look is two or more values, one a
 * preset does not give: a single value, or values presets give alone, are
 * presets' (repeatedStyleValues()). A block in a block style has its look.
 */
export function repeatedLooks(
	markup: string
): Array< { blockName: string; blocks: number; styles: Record< string, unknown > } > {
	const looks = new Map<
		string,
		{ blockName: string; blocks: number; styles: Record< string, unknown > }
	>();
	for ( const [ , name, json ] of markup.matchAll( NAMED_BLOCK ) ) {
		let attributes: Record< string, unknown >;
		try {
			attributes = JSON.parse( json );
		} catch {
			continue;
		}
		if ( String( attributes.className ?? '' ).includes( 'is-style-' ) ) {
			continue;
		}
		const styles: Record< string, Record< string, unknown > > = structuredClone(
			( attributes.style as Record< string, Record< string, unknown > > ) ?? {}
		);
		for ( const [ attribute, [ group, key, kind ] ] of Object.entries( PRESET_ATTRIBUTES ) ) {
			if ( typeof attributes[ attribute ] === 'string' ) {
				styles[ group ] = {
					...styles[ group ],
					[ key ]: `var:preset|${ kind }|${ attributes[ attribute ] }`,
				};
			}
		}
		const values: Array< [ string, string ] > = [];
		leaves( styles, '', values );
		if ( values.length < 2 || values.every( ( [ at ] ) => PRESET_GIVES.test( at ) ) ) {
			continue;
		}
		const blockName = name.includes( '/' ) ? name : `core/${ name }`;
		const key = `${ blockName } ${ JSON.stringify( sortKeys( styles ) ) }`;
		const seen = looks.get( key ) ?? { blockName, blocks: 0, styles: sortKeys( styles ) };
		seen.blocks++;
		looks.set( key, seen );
	}
	return [ ...looks.values() ].filter( ( { blocks } ) => blocks >= REPEATED );
}

function sortKeys< T >( value: T ): T {
	return value && typeof value === 'object' && ! Array.isArray( value )
		? ( Object.fromEntries(
				Object.keys( value )
					.sort()
					.map( ( key ) => [ key, sortKeys( ( value as Record< string, unknown > )[ key ] ) ] )
		  ) as T )
		: value;
}

/** A note on each look several blocks of one type in `label` share whole. */
function repeatedLookNotes( markup: string, label: string ): string[] {
	return repeatedLooks( markup ).map(
		( { blockName, blocks, styles } ) =>
			`${ blocks } ${ blockName } blocks in ${ label } share one look: ${ JSON.stringify(
				styles
			) }. A look blocks of one type share is a block style in WordPress: a theme's styles/<slug>.json with "blockTypes": [ "${ blockName }" ] and that look as its "styles", which WordPress registers (WP_Theme_JSON_Resolver::get_style_variations() in wp-includes/class-wp-theme-json-resolver.php), the block's Styles panel offers, and Global Styles edits for every block in it. A block takes it as "className":"is-style-<slug>".`
	);
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
	{ siteRoot, theme, label }: Holder,
	kind: PresetKind,
	values: string[],
	presets: Array< [ string, string ] >
): Promise< { note: string; added: string[] } | undefined > {
	const made = MADE[ kind ];
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
		note: `Studio made the ${ made.name }s ${ label } repeats ${ made.name } presets of ${
			theme.slug
		}: it added ${ added
			.map( ( [ slug, value ] ) => `${ slug } (${ value })` )
			.join(
				', '
			) } to ${ themeJsonFile }'s "settings": { "${ group }": { "${ list }" } }, which Studio's save of it through the block editor stores its blocks of those values as, as the editor stores a picked preset (Block validation reports it). ${
			made.renders
		} Each preset's "name" is its value; a name that says what it is for labels it in the editor.`,
	};
}

/** Where block markup is held: its site, the theme it renders with, and its name for a note. */
interface Holder {
	/** The app the agent runs in. */
	host: StudioAgentHost;
	siteRoot: string;
	theme?: { slug: string; dir: string };
	label: string;
	/** The rest of the markup the site renders with the holder's. */
	others: Markup[];
}

/**
 * The rest of the block markup the site renders with a theme's: its files,
 * and the content in the database when it is the active theme, `except` the
 * holder itself. Files a gate cannot save through the editor are left out.
 */
async function otherMarkup(
	siteRoot: string,
	theme: { slug: string; dir: string } | undefined,
	except: { file?: string; post?: number }
): Promise< Markup[] > {
	if ( ! theme ) {
		return [];
	}
	const active = await readWordPressSite( siteRoot, ( site ): unknown[] => [
		site.option( 'stylesheet' ),
		site.option( 'template' ),
	] ).catch( (): unknown[] => [] );
	const markup = await siteMarkup( siteRoot, theme.dir, {
		posts: active.includes( theme.slug ),
		holding: '%"style":%',
	} );
	return markup.filter(
		( item ) =>
			( item.file ? item.file !== except.file && isBlockMarkupFile( item.file ) : true ) &&
			( item.post === undefined || item.post !== except.post )
	);
}

/**
 * Saves each of `others` that sets one of `values` through the block editor
 * with the theme's presets, which stores those values as the presets, as it
 * stores a picked preset: the gate's lossless save. Returns where it saved.
 */
async function saveWithPresets(
	{ host, siteRoot, theme, others }: Holder,
	values: string[]
): Promise< string[] > {
	const holding = others.filter( ( item ) =>
		values.some( ( value ) => item.content.includes( `"${ value }"` ) )
	);
	if ( ! holding.length ) {
		return [];
	}
	const siteUrl = ( await host.sites.resolve( siteRoot ) ).url;
	const presetValues = await sitePresetValues( host, siteRoot, theme?.slug );
	const saved: string[] = [];
	for ( const item of holding ) {
		const { fixedContent } = item.file
			? await validateBlockMarkupFile( item.file, siteUrl, presetValues )
			: await validateBlockMarkup(
					item.content,
					placeOf( item ),
					siteUrl,
					presetValues,
					blockEditorOf( item )
			  );
		if ( fixedContent !== undefined ) {
			await saveMarkup( host, siteRoot, item, fixedContent );
			saved.push( placeOf( item, theme?.dir ) );
		}
	}
	return saved;
}

/**
 * Makes each raw font size and spacing value the markup repeats a preset of
 * the theme it renders with, for a save through the block editor to store
 * its blocks with, where nothing can look different. Returns the notes on
 * what it added, and the repeated values it left raw.
 */
async function presetsForRepeatedValues(
	holder: Holder,
	markup: string,
	presets: Record< PresetKind, Array< [ string, string ] > >
) {
	const kindOf = ( at: string ) => STYLES.find( ( style ) => style.path.test( at ) )?.kind;
	// A value a preset has the save stores as the preset (storePresetValues()
	// in block-validator.ts).
	const stored = ( { path: at, value }: { path: string; value: string } ) => {
		const kind = kindOf( at );
		return (
			( kind === 'fontSizes' || kind === 'spacingSizes' ) &&
			presets[ kind ].some( ( [ , size ] ) => size === value )
		);
	};
	let repeated = repeatedStyleValues(
		markup,
		holder.others.map( ( item ) => item.content )
	).filter( ( value ) => ! stored( value ) );
	const made: Array< { note: string; added: string[]; kind: PresetKind } > = [];
	for ( const kind of Object.keys( MADE ) as PresetKind[] ) {
		const values = repeated
			.filter( ( value ) => kindOf( value.path ) === kind )
			.map( ( { value } ) => value );
		const added = values.length
			? await addPresets( holder, kind, values, presets[ kind ] ).catch( () => undefined )
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
	const saved = made.length
		? await saveWithPresets(
				holder,
				made.flatMap( ( { added } ) => added )
		  ).catch( () => [] )
		: [];
	if ( saved.length ) {
		notes.push(
			`Studio saved ${ saved.join(
				', '
			) }, which set the same values, through the block editor with those presets, which stores their blocks as it stores a picked preset.`
		);
	}
	return { notes, repeated };
}

/**
 * Makes the raw font sizes and spacing values content in the database repeats
 * presets of the active theme, for the save of it through the block editor
 * (post-content-check.ts) to store its blocks with. Returns the notes.
 */
export async function repeatedPostStyleNotes(
	host: StudioAgentHost,
	siteRoot: string,
	post: number,
	content: string,
	label: string
): Promise< string[] > {
	const looks = repeatedLookNotes( content, label );
	if ( ! rawStyleValues( content ).length ) {
		return looks;
	}
	const found = await readWordPressSite( siteRoot, async ( site ) => ( {
		presets: await themePresets( host, site ),
		slug: site.option( 'stylesheet' ),
	} ) );
	if ( ! found?.presets || typeof found.slug !== 'string' ) {
		return looks;
	}
	const theme = { slug: found.slug, dir: path.join( siteRoot, 'wp-content/themes', found.slug ) };
	const others = await otherMarkup( siteRoot, theme, { post } );
	const { notes } = await presetsForRepeatedValues(
		{ host, siteRoot, theme, label, others },
		content,
		found.presets
	);
	return [ ...notes, ...looks ];
}

/** The raw values of a kind presets give that block markup just written repeats. */
export async function repeatedStyleValueNotes(
	host: StudioAgentHost,
	siteFile: SiteFile,
	{ gateSaves = false }: { gateSaves?: boolean } = {}
): Promise< string[] > {
	if ( ! isBlockMarkup( siteFile ) ) {
		return [];
	}
	const file = path.join( siteFile.siteRoot, siteFile.relativePath );
	const markup = await readFile( file, 'utf8' );
	const looks = repeatedLookNotes( markup, file );
	// The site's markup is read only for a file that sets a raw value.
	if ( ! rawStyleValues( markup ).length ) {
		return looks;
	}
	const others = await otherMarkup( siteFile.siteRoot, siteFile.theme, { file } );
	// The presets the file renders with: its theme's, or the active theme's.
	const presets = await readWordPressSite( siteFile.siteRoot, ( site ) =>
		themePresets( host, site, siteFile.theme?.slug )
	);
	if ( ! presets ) {
		return looks;
	}
	// The block validation gate saves the file through the editor, which stores a
	// value a preset has as the preset.
	const { notes, repeated } =
		gateSaves && isBlockMarkupFile( file )
			? await presetsForRepeatedValues(
					{ host, siteRoot: siteFile.siteRoot, theme: siteFile.theme, label: file, others },
					markup,
					presets
			  )
			: {
					notes: [],
					repeated: repeatedStyleValues(
						markup,
						others.map( ( item ) => item.content )
					),
			  };
	const kinds = STYLES.map( ( style ) => ( {
		...style,
		values: repeated.filter( ( value ) => style.path.test( value.path ) ),
	} ) ).filter( ( style ) => style.values.length );
	if ( ! kinds.length ) {
		return [ ...notes, ...looks ];
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
		...looks,
	];
}
