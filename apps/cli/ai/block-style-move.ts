/**
 * Moves a look that a theme's stylesheet gives a class several blocks of one
 * type share into a block style, WordPress's form for it: the theme's
 * styles/blocks/<class>.json, which WordPress registers for its blockTypes
 * (WP_Theme_JSON_Resolver::get_style_variations() in
 * wp-includes/class-wp-theme-json-resolver.php), the block's Styles panel
 * offers, and Global Styles edits, as Twenty Twenty-Five's are.
 *
 * The move keeps the look: the class's rules go to the block style's "styles": { "css" }
 * as they were, which WordPress prints for each block that has the style
 * (wp_render_block_style_variation_support_styles() in
 * wp-includes/block-supports/block-style-variations.php), and each block
 * keeps its class beside the style's `is-style-<class>`, so a rule for what
 * is inside it still applies. WordPress prints the style in `:root :where()`,
 * at the weight of one class, as a rule of the class alone has; a state such
 * as `:hover` prints at that weight too. A class is moved only when its own
 * top-level rules in the theme's stylesheets are all that style it, and only
 * when every element that carries it is a block that can take the style;
 * otherwise nothing is.
 */
import { existsSync, readFileSync } from 'fs';
import { mkdir, readdir, writeFile } from 'fs/promises';
import path from 'path';
import { readWordPressSite } from 'cli/ai/site-database';
import { placeOf, saveMarkup, type Markup } from 'cli/ai/site-markup';
import { isUpdatableTheme } from 'cli/ai/themes';

interface Rule {
	start: number;
	end: number;
	selectors: string[];
	body: string;
	topLevel: boolean;
}

// The CSS with its comments and strings blanked, so braces in them are not
// read as rules, at the same offsets.
function mask( css: string ): string {
	return css.replace( /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ( text ) =>
		text[ 0 ] === '/'
			? ' '.repeat( text.length )
			: text[ 0 ] + ' '.repeat( text.length - 2 ) + text[ 0 ]
	);
}

function closing( masked: string, open: number ): number {
	let depth = 0;
	for ( let i = open; i < masked.length; i++ ) {
		depth += masked[ i ] === '{' ? 1 : masked[ i ] === '}' ? -1 : 0;
		if ( ! depth ) {
			return i;
		}
	}
	return masked.length;
}

/** Each style rule of a stylesheet, at any depth of its at-rules. */
function cssRules( css: string ): Rule[] {
	const masked = mask( css );
	const rules: Rule[] = [];
	const walk = ( from: number, to: number, topLevel: boolean ) => {
		let start = from;
		for ( let i = from; i < to; i++ ) {
			if ( masked[ i ] === ';' || masked[ i ] === '}' ) {
				start = i + 1;
			} else if ( masked[ i ] === '{' ) {
				const end = closing( masked, i );
				const prelude = masked.slice( start, i ).trim();
				if ( prelude.startsWith( '@' ) ) {
					walk( i + 1, end, false );
				} else {
					rules.push( {
						start:
							start +
							( masked.slice( start, i ).length - masked.slice( start, i ).trimStart().length ),
						end: end + 1,
						selectors: prelude.split( ',' ).map( ( selector ) => selector.trim() ),
						body: css.slice( i + 1, end ),
						topLevel,
					} );
				}
				i = end;
				start = end + 1;
			}
		}
	};
	walk( 0, masked.length, true );
	return rules;
}

/** A class in a selector. */
const token = ( name: string ) => new RegExp( `\\.${ name }(?![A-Za-z0-9_-])` );

// What follows the class in a selector of the class alone, as `:hover` in
// `.card:hover`, or undefined for any other selector.
function ownState( selector: string, name: string ): string | undefined {
	return selector.match( new RegExp( `^\\.${ name }((?:::?[a-z-]+)*)$` ) )?.[ 1 ];
}

// Whether a selector styles the element that has the class, rather than one
// inside it.
function stylesClassed( selector: string, name: string ): boolean {
	const compounds = selector.split( /\s*[>+~]\s*|\s+/ );
	return token( name ).test( compounds[ compounds.length - 1 ] );
}

// A selector's specificity as one number, ids then classes and pseudo-classes
// then types, or undefined for one whose arguments set it (:where(), :is(),
// :not(), :has()). What it leaves out only lowers it.
function specificity( selector: string ): number | undefined {
	if ( /:(where|is|not|has|matches)\(/.test( selector ) ) {
		return undefined;
	}
	const count = ( pattern: RegExp ) => selector.match( pattern )?.length ?? 0;
	return (
		count( /#[A-Za-z0-9_-]+/g ) * 10000 +
		count( /\.[A-Za-z0-9_-]+|(?<!:):[a-z-]+/g ) * 100 +
		count( /(^|[\s>+~])[a-z][a-z0-9-]*/gi )
	);
}

// A block style's css prints as `:root :where(.is-style-<slug>)`, one class's
// weight (WP_Theme_JSON::process_blocks_custom_css() in
// wp-includes/class-wp-theme-json.php).
const BLOCK_STYLE_WEIGHT = 100;

// Whether a rule styling the class in a context, as `.grid > .card`, stays in
// the stylesheet as it renders: the block keeps its class, and the rule
// outweighs the block style's, as it outweighed the class's own rule.
const outweighs = ( selector: string ) => ( specificity( selector ) ?? 0 ) > BLOCK_STYLE_WEIGHT;

/** The block style's css for a class, from the stylesheets: undefined if a rule it cannot move styles it. */
export function movableCss( stylesheets: string[], name: string ): string | undefined {
	const css: string[] = [];
	for ( const stylesheet of stylesheets ) {
		for ( const rule of cssRules( stylesheet ) ) {
			const styled = rule.selectors.filter( ( selector ) => stylesClassed( selector, name ) );
			if (
				! styled.length ||
				( rule.topLevel &&
					styled.every( outweighs ) &&
					! rule.selectors.some( ( selector ) => ownState( selector, name ) !== undefined ) )
			) {
				continue;
			}
			const states = rule.selectors.map( ( selector ) => ownState( selector, name ) );
			if ( ! rule.topLevel || rule.body.includes( '{' ) || states.includes( undefined ) ) {
				return undefined;
			}
			const declarations = rule.body.trim().replace( /;?$/, ';' );
			for ( const state of states ) {
				css.push( state ? `&${ state } { ${ declarations } }` : declarations );
			}
		}
	}
	return css.length ? css.join( ' ' ) : undefined;
}

/** A stylesheet without the class's rules. */
export function withoutRules( stylesheet: string, name: string ): string {
	let text = stylesheet;
	for ( const rule of cssRules( stylesheet ).reverse() ) {
		if ( rule.selectors.some( ( selector ) => ownState( selector, name ) !== undefined ) ) {
			const end = text[ rule.end ] === '\n' ? rule.end + 1 : rule.end;
			text = text.slice( 0, rule.start ) + text.slice( end );
		}
	}
	return text;
}

const BLOCK = /<!--\s+wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)\s+(\{.*?\})\s+(\/?)-->/g;

/**
 * Block markup with `is-style-<class>` beside the class on each block that
 * carries it, in its attributes and its element's class, or undefined if a
 * block's element has no class to add it to.
 */
export function withBlockStyle( markup: string, name: string ): string | undefined {
	const style = `is-style-${ name }`;
	let out = '';
	let last = 0;
	for ( const match of markup.matchAll( BLOCK ) ) {
		const [ comment, , json, selfClosing ] = match;
		let className: unknown;
		try {
			className = JSON.parse( json ).className;
		} catch {
			continue;
		}
		const classes = String( className ?? '' ).split( /\s+/ );
		if ( ! classes.includes( name ) || classes.includes( style ) ) {
			continue;
		}
		const attribute = `"className":${ JSON.stringify( className ) }`;
		if ( ! json.includes( attribute ) ) {
			return undefined;
		}
		const updated = comment.replace(
			attribute,
			`"className":${ JSON.stringify( `${ className } ${ style }` ) }`
		);
		const after = match.index + comment.length;
		out += markup.slice( last, match.index ) + updated;
		last = after;
		if ( selfClosing ) {
			continue;
		}
		// The block's element is the first tag after its comment.
		const tag = markup.slice( after ).match( /^\s*<[a-z][a-z0-9-]*\b[^>]*>/i )?.[ 0 ];
		const classAttribute = tag?.match( /\sclass="([^"]*)"/ );
		if ( ! tag || ! classAttribute || ! classAttribute[ 1 ].split( /\s+/ ).includes( name ) ) {
			return undefined;
		}
		out += tag.replace( classAttribute[ 0 ], ` class="${ classAttribute[ 1 ] } ${ style }"` );
		last = after + tag.length;
	}
	return out + markup.slice( last );
}

// Whether an element carries the class without the style: one that is not a
// block's, as in a core/html block.
function carriedWithoutStyle( markup: string, name: string ): boolean {
	return [ ...markup.matchAll( /\sclass="([^"]*)"/g ) ].some( ( [ , classes ] ) => {
		const list = classes.split( /\s+/ );
		return list.includes( name ) && ! list.includes( `is-style-${ name }` );
	} );
}

// Whether something Studio does not move names the class: another theme file,
// whose code or markup may print or style it, or CSS the site saved, which
// WordPress prints after the theme's (Additional CSS, Global Styles).
async function namedElsewhere(
	siteRoot: string,
	themeDir: string,
	name: string,
	moved: string[]
): Promise< boolean > {
	const word = new RegExp( `(^|[^A-Za-z0-9_-])${ name }(?![A-Za-z0-9_-])` );
	const entries = await readdir( themeDir, { recursive: true, withFileTypes: true } );
	const files = entries
		.filter( ( entry ) => entry.isFile() && /\.(php|js|html|json)$/.test( entry.name ) )
		.map( ( entry ) => path.join( entry.parentPath, entry.name ) )
		.filter(
			( file ) =>
				! moved.includes( file ) && ! file.includes( `${ path.sep }node_modules${ path.sep }` )
		);
	if ( files.some( ( file ) => word.test( readFileSync( file, 'utf8' ) ) ) ) {
		return true;
	}
	const saved = await readWordPressSite( siteRoot, ( site ) =>
		site.query< { content: string } >(
			`SELECT post_content AS content FROM ${ site.prefix }posts WHERE post_type IN ('custom_css', 'wp_global_styles')`
		)
	);
	return saved.some( ( { content } ) => token( name ).test( content ) );
}

const title = ( name: string ) =>
	name
		.split( /[-_]+/ )
		.filter( Boolean )
		.map( ( word ) => word[ 0 ].toUpperCase() + word.slice( 1 ) )
		.join( ' ' );

/**
 * Moves a class's look into a block style of the theme for the block types
 * that carry it, and says what Studio did; undefined, changing nothing, if it
 * cannot be moved as it renders.
 */
export async function moveToBlockStyle(
	siteRoot: string,
	themeDir: string,
	name: string,
	blockTypes: string[],
	stylesheets: string[],
	markup: Markup[]
): Promise< string | undefined > {
	const styleFile = path.join( themeDir, 'styles', 'blocks', `${ name }.json` );
	if (
		existsSync( styleFile ) ||
		( await isUpdatableTheme( siteRoot, path.basename( themeDir ) ) )
	) {
		return undefined;
	}
	const sheets = stylesheets.map( ( file ) => ( { file, css: readFileSync( file, 'utf8' ) } ) );
	const css = movableCss(
		sheets.map( ( sheet ) => sheet.css ),
		name
	);
	const styled = markup.map( ( item ) => ( {
		...item,
		styled: withBlockStyle( item.content, name ),
	} ) );
	if (
		! css ||
		styled.some(
			( item ) => item.styled === undefined || carriedWithoutStyle( item.styled, name )
		) ||
		( await namedElsewhere( siteRoot, themeDir, name, [
			...stylesheets,
			...markup.flatMap( ( item ) => item.file ?? [] ),
		] ) )
	) {
		return undefined;
	}
	const changed = styled.filter( ( item ) => item.styled !== item.content );
	// The posts first: one Studio cannot save leaves the stylesheet as it was.
	for ( const item of changed.filter( ( candidate ) => candidate.post ) ) {
		try {
			await saveMarkup( siteRoot, item, item.styled! );
		} catch {
			return undefined;
		}
	}
	for ( const item of changed.filter( ( candidate ) => candidate.file ) ) {
		await writeFile( item.file!, item.styled!, 'utf8' );
	}
	await mkdir( path.dirname( styleFile ), { recursive: true } );
	await writeFile(
		styleFile,
		JSON.stringify(
			{
				$schema: 'https://schemas.wp.org/trunk/theme.json',
				version: 3,
				title: title( name ),
				slug: name,
				blockTypes,
				styles: { css },
			},
			null,
			'\t'
		) + '\n',
		'utf8'
	);
	const moved = [];
	for ( const sheet of sheets ) {
		const rest = withoutRules( sheet.css, name );
		if ( rest !== sheet.css ) {
			await writeFile( sheet.file, rest, 'utf8' );
			moved.push( path.relative( themeDir, sheet.file ) );
		}
	}
	const places = changed.map( ( item ) => placeOf( item, themeDir ) );
	return `Studio moved the look \`.${ name }\` gives ${ blockTypes.join(
		', '
	) } blocks into a block style, WordPress's form for a look blocks of one type share: ${ styleFile }, which WordPress registers for its "blockTypes" (WP_Theme_JSON_Resolver::get_style_variations() in wp-includes/class-wp-theme-json-resolver.php), the block's Styles panel offers, and Global Styles edits. Its rules moved from ${ moved.join(
		', '
	) } into the style's "styles": { "css" }, as they were, and the blocks in ${ places.join(
		', '
	) } carry "is-style-${ name }" beside "${ name }", so they render as before. A block takes the look as "className":"is-style-${ name }"; the style's "styles" can hold each property at its path (WP_Theme_JSON::PROPERTIES_METADATA in wp-includes/class-wp-theme-json.php).`;
}
