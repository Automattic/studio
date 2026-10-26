/**
 * The raw style values block markup just written sets on several blocks, of
 * the kinds of value presets give. A block takes a preset by its slug,
 * as `"fontSize":"small"` or `var:preset|spacing|40`, which WordPress renders
 * as the preset's CSS variable (wp_typography_get_css_variable_inline_style()
 * in wp-includes/block-supports/typography.php, WP_Style_Engine in
 * wp-includes/style-engine/class-wp-style-engine.php): the editor offers it,
 * and Global Styles changes it for every block that uses it. The same raw
 * value on many blocks is one treatment kept in many places.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { readWordPressSite } from 'cli/ai/site-database';
import { isBlockMarkup, type SiteFile } from 'cli/ai/site-file-guards';
import { themePresets } from 'cli/ai/theme-presets';

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

/** The raw values of a kind presets give that block markup just written repeats. */
export async function repeatedStyleValueNotes( siteFile: SiteFile ): Promise< string[] > {
	if ( ! isBlockMarkup( siteFile ) ) {
		return [];
	}
	const file = path.join( siteFile.siteRoot, siteFile.relativePath );
	const repeated = repeatedStyleValues( await readFile( file, 'utf8' ) );
	if ( ! repeated.length ) {
		return [];
	}
	// The presets the file renders with: its theme's, or the active theme's.
	const presets = await readWordPressSite( siteFile.siteRoot, ( site ) =>
		themePresets( site, siteFile.theme?.slug )
	);
	const kinds = STYLES.map( ( style ) => ( {
		...style,
		values: repeated.filter( ( value ) => style.path.test( value.path ) ),
	} ) ).filter( ( style ) => style.values.length );
	if ( ! presets || ! kinds.length ) {
		return [];
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
	];
}
