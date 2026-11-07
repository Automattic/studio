/**
 * The blocks a style just changed in a theme's theme.json does not reach,
 * because they set the same property themselves. WordPress prints a theme's
 * element and block styles as stylesheet rules without `!important`
 * (WP_Theme_JSON::get_styles_for_block() in wp-includes/class-wp-theme-json.php),
 * while a block's own style renders as an inline style on the block (the
 * block supports in wp-includes/block-supports/) and its preset as a class
 * whose rule is `!important` (WP_Theme_JSON::compute_preset_classes()), so
 * the block's own value is what shows.
 */
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { placeOf, siteMarkup } from '@studio/agent/node/site-markup';
import type { SiteFile } from '@studio/agent/node/site-file';

// The elements whose selector matches a block's own element
// (WP_Theme_JSON::ELEMENTS), by the blocks that render it.
const HEADINGS = [ 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' ];

// The block attributes that take a preset, and the style each one sets.
const PRESET_ATTRIBUTES: Record< string, [ string, string ] > = {
	fontSize: [ 'typography.fontSize', 'font-size' ],
	fontFamily: [ 'typography.fontFamily', 'font-family' ],
	textColor: [ 'color.text', 'color' ],
	backgroundColor: [ 'color.background', 'color' ],
	gradient: [ 'color.gradient', 'gradient' ],
};

// The keys of a style object that hold other styles rather than a property.
const NESTED = new Set( [ 'elements', 'blocks', 'variations', 'css' ] );

const BLOCK = /<!--\s+wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)(?:\s+(\{.*?\}))?\s+\/?-->/g;

/** One style a theme.json sets: where, the property's path, and its value. */
interface ThemeStyle {
	at: string;
	property: string;
	value: string;
	reaches: ( name: string, attrs: Record< string, unknown > ) => boolean;
}

// A preset as the block editor stores it, so `var(--wp--preset--color--x)` and `var:preset|color|x` compare equal.
function normalize( value: unknown ): string {
	return String( value )
		.trim()
		.replace( /^var\(--wp--preset--([a-z0-9-]+)--([^)]+)\)$/i, 'var:preset|$1|$2' )
		.toLowerCase();
}

function leaves( styles: unknown, prefix = '' ): Array< [ string, string ] > {
	if ( ! styles || typeof styles !== 'object' ) {
		return [];
	}
	return Object.entries( styles ).flatMap( ( [ key, value ] ) => {
		if ( NESTED.has( key ) || key.startsWith( ':' ) ) {
			return [];
		}
		const at = prefix ? `${ prefix }.${ key }` : key;
		return value && typeof value === 'object'
			? leaves( value, at )
			: [ [ at, String( value ) ] as [ string, string ] ];
	} );
}

// The heading level each core block with a `level` renders by default, from its block.json.
function defaultLevels( siteRoot: string ): Map< string, number > {
	const blocksDir = path.join( siteRoot, 'wp-includes/blocks' );
	const levels = new Map< string, number >();
	for ( const slug of readdirSync( blocksDir, { withFileTypes: true } ) ) {
		try {
			const json = JSON.parse(
				readFileSync( path.join( blocksDir, slug.name, 'block.json' ), 'utf8' )
			);
			const level = json.attributes?.level?.default;
			if ( typeof level === 'number' ) {
				levels.set( json.name, level );
			}
		} catch {
			// A directory without a block.json renders no heading.
		}
	}
	return levels;
}

function themeStyles( json: unknown, levels: Map< string, number > ): ThemeStyle[] {
	const styles = ( json as { styles?: Record< string, Record< string, unknown > > } )?.styles;
	const level = ( name: string, attrs: Record< string, unknown > ) => {
		const found = typeof attrs.level === 'number' ? attrs.level : levels.get( name );
		return found && found >= 1 && found <= 6 ? found : undefined;
	};
	const targets: Array< [ string, unknown, ThemeStyle[ 'reaches' ] ] > = [
		[
			'styles.elements.heading',
			styles?.elements?.heading,
			( name, attrs ) => !! level( name, attrs ),
		],
		...HEADINGS.map( ( tag, i ): [ string, unknown, ThemeStyle[ 'reaches' ] ] => [
			`styles.elements.${ tag }`,
			styles?.elements?.[ tag ],
			( name, attrs ) => level( name, attrs ) === i + 1,
		] ),
		[ 'styles.elements.button', styles?.elements?.button, ( name ) => name === 'core/button' ],
		...Object.entries( styles?.blocks ?? {} ).map(
			( [ block, value ] ): [ string, unknown, ThemeStyle[ 'reaches' ] ] => [
				`styles.blocks.${ block }`,
				value,
				( name ) => name === block,
			]
		),
	];
	return targets.flatMap( ( [ at, value, reaches ] ) =>
		leaves( value ).map( ( [ property, set ] ) => ( { at, property, value: set, reaches } ) )
	);
}

const key = ( { at, property, value }: ThemeStyle ) => `${ at }.${ property } ${ value }`;

function ownValue( attrs: Record< string, unknown >, property: string ): string | undefined {
	for ( const [ attribute, [ style, kind ] ] of Object.entries( PRESET_ATTRIBUTES ) ) {
		if ( style === property && typeof attrs[ attribute ] === 'string' ) {
			return `var:preset|${ kind }|${ attrs[ attribute ] }`;
		}
	}
	const value = property
		.split( '.' )
		.reduce< unknown >(
			( at, key ) =>
				at && typeof at === 'object' ? ( at as Record< string, unknown > )[ key ] : undefined,
			attrs.style
		);
	return value === undefined || ( value && typeof value === 'object' )
		? undefined
		: String( value );
}

/**
 * Notes on the styles a theme.json write changed, from its text `before`,
 * that blocks on the site set for themselves.
 */
export async function themeStyleOverrideNotes(
	{ siteRoot, theme }: SiteFile,
	before?: string
): Promise< string[] > {
	if ( theme?.file !== 'theme.json' || before === undefined ) {
		return [];
	}
	const file = path.join( theme.dir, 'theme.json' );
	const levels = defaultLevels( siteRoot );
	const had = new Set( themeStyles( before ? JSON.parse( before ) : {}, levels ).map( key ) );
	const styles = themeStyles( JSON.parse( readFileSync( file, 'utf8' ) ), levels ).filter(
		( style ) => ! had.has( key( style ) )
	);
	if ( ! styles.length ) {
		return [];
	}
	const markup = await siteMarkup( siteRoot, theme.dir );
	const notes: string[] = [];
	for ( const style of styles ) {
		// The blocks that set their own value, by place and value.
		const own = new Map< string, number >();
		for ( const item of markup ) {
			for ( const [ , rawName, json ] of item.content.matchAll( BLOCK ) ) {
				const name = rawName.includes( '/' ) ? rawName : `core/${ rawName }`;
				let attrs: Record< string, unknown >;
				try {
					attrs = json ? JSON.parse( json ) : {};
				} catch {
					continue;
				}
				if ( ! style.reaches( name, attrs ) ) {
					continue;
				}
				const value = ownValue( attrs, style.property );
				if ( value !== undefined && normalize( value ) !== normalize( style.value ) ) {
					const key = `${ name } ${ value } in ${ placeOf( item, theme.dir ) }`;
					own.set( key, ( own.get( key ) ?? 0 ) + 1 );
				}
			}
		}
		if ( ! own.size ) {
			continue;
		}
		const count = [ ...own.values() ].reduce( ( sum, n ) => sum + n, 0 );
		const where = [ ...own ].map( ( [ key, n ] ) => `${ key } (${ n })` ).join( ', ' );
		notes.push(
			`${ file }'s ${ style.at }.${ style.property } ${
				style.value
			} does not show on ${ count } block${
				count === 1 ? '' : 's'
			} that set their own: ${ where }. A block's own style renders inline on it (wp-includes/block-supports/) and its preset as a class marked !important, over the theme's styles (WP_Theme_JSON::get_styles_for_block()); taking the block's own value out lets the theme's show.`
		);
	}
	return notes;
}
