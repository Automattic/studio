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
import { readWordPressSite } from '@studio/agent/node/site-database';
import { placeOf, saveMarkup, type Markup } from '@studio/agent/node/site-markup';
import { isUpdatableTheme } from '@studio/agent/node/themes';
import type { StudioAgentHost } from '@studio/agent/node/host';

interface Rule {
	start: number;
	end: number;
	selectors: string[];
	// The selectors as written, strings and comments in them kept.
	written: string[];
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

// The selectors of a prelude as written, split where the masked one has a comma.
function written( css: string, from: number, to: number ): string[] {
	const masked = mask( css.slice( from, to ) );
	const selectors: string[] = [];
	let start = 0;
	for ( let i = 0; i <= masked.length; i++ ) {
		if ( i === masked.length || masked[ i ] === ',' ) {
			selectors.push( css.slice( from + start, from + i ).trim() );
			start = i + 1;
		}
	}
	return selectors;
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
						written: written( css, start, i ),
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

/**
 * The class WordPress gives every block of a type, as `wp-block-group`
 * (wp_get_block_default_classname() in
 * wp-includes/block-supports/generated-classname.php).
 */
function blockClassName( blockType: string ): string {
	return `wp-block-${ blockType.replace( '/', '-' ).replace( /^core-/, '' ) }`;
}

// What follows the class in a selector of the class alone, as `:hover` in
// `.card:hover`, or undefined for any other selector. The class of the block
// types that carry it beside it, as `.wp-block-group.card`, names the same
// elements, as every one of them has that class.
function ownState( selector: string, name: string, blockTypes: string[] ): string | undefined {
	const blockClasses = blockTypes.map( blockClassName ).join( '|' );
	const beside = blockClasses ? `(?:\\.(?:${ blockClasses }))?` : '';
	return selector.match(
		new RegExp( `^${ beside }\\.${ name }${ beside }((?:::?[a-z-]+)*)$` )
	)?.[ 1 ];
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

// A rule's declarations, each with the whitespace before it, split where the
// masked body has a semicolon, so one in a string or comment stays in its
// declaration; and what follows the last.
function declarations( body: string ): { property: string; text: string }[] {
	const masked = mask( body );
	const parts: { property: string; text: string }[] = [];
	let from = 0;
	for ( let i = 0; i <= masked.length; i++ ) {
		if ( i === masked.length || masked[ i ] === ';' ) {
			const text = body.slice( from, i );
			const bare = mask( text );
			const colon = bare.indexOf( ':' );
			parts.push( {
				property: colon < 0 ? '' : bare.slice( 0, colon ).trim().toLowerCase(),
				text,
			} );
			from = i + 1;
		}
	}
	return parts;
}

// Whether two properties can set the same thing, as `padding` and
// `padding-top`, or `background` and `background-color` do.
const related = ( one: string, other: string ) =>
	one === other || one.startsWith( `${ other }-` ) || other.startsWith( `${ one }-` );

interface MovePlan {
	// The block style's "styles": { "css" }.
	css: string;
	// Each stylesheet without what moved.
	stylesheets: string[];
	// The properties the class's own rules keep, as a rule left in place also sets them.
	kept: string[];
}

/**
 * What of a class's look the stylesheets let Studio move into a block style as
 * it renders, or undefined for nothing. A declaration of a rule of the class
 * alone moves; one a rule that stays also sets, as one in a media query or one
 * for the class in a context no weightier than the block style, stays beside
 * it in the class's rule, so the two meet in the stylesheet as before. A
 * selector the rule lists beside the class's keeps the rule's declarations.
 */
export function planMove(
	stylesheets: string[],
	name: string,
	blockTypes: string[] = []
): MovePlan | undefined {
	const sheets = stylesheets.map( ( css ) => ( { css, rules: cssRules( css ) } ) );
	const held = new Set< string >();
	for ( const rule of sheets.flatMap( ( sheet ) => sheet.rules ) ) {
		// CSS nesting, which Studio does not read into.
		if ( rule.body.includes( '{' ) && token( name ).test( rule.selectors + rule.body ) ) {
			return undefined;
		}
		const stays = rule.selectors.filter(
			( selector ) =>
				stylesClassed( selector, name ) &&
				ownState( selector, name, blockTypes ) === undefined &&
				! ( rule.topLevel && outweighs( selector ) )
		);
		const own = rule.selectors.some(
			( selector ) => ownState( selector, name, blockTypes ) !== undefined
		);
		if ( stays.length || ( own && ! rule.topLevel ) ) {
			declarations( rule.body ).forEach( ( { property } ) => property && held.add( property ) );
		}
	}
	const isHeld = ( property: string ) =>
		[ ...held ].some( ( other ) => related( property, other ) );
	const css: string[] = [];
	const kept = new Set< string >();
	const rewritten = sheets.map( ( { css: text, rules } ) => {
		let out = text;
		const found: string[] = [];
		for ( const rule of [ ...rules ].reverse() ) {
			const states = rule.selectors.map( ( selector ) => ownState( selector, name, blockTypes ) );
			// A rule of the class in an at-rule is held, so nothing of it moves.
			if ( states.every( ( state ) => state === undefined ) ) {
				continue;
			}
			const parts = declarations( rule.body );
			const moving = parts.filter( ( part ) => part.property && ! isHeld( part.property ) );
			if ( ! moving.length ) {
				continue;
			}
			const body = moving.map( ( part ) => part.text.trim() ).join( '; ' ) + ';';
			found.unshift(
				...states.flatMap( ( state ) =>
					state === undefined ? [] : [ state ? `&${ state } { ${ body } }` : body ]
				)
			);
			const staying = parts.filter( ( part ) => ! moving.includes( part ) );
			staying.forEach( ( part ) => part.property && kept.add( part.property ) );
			const others = rule.written.filter( ( _, i ) => states[ i ] === undefined );
			const ownSelectors = rule.written.filter( ( _, i ) => states[ i ] !== undefined );
			const replacement = [
				staying.some( ( part ) => part.property )
					? `${ ownSelectors.join( ', ' ) } {${ staying.map( ( part ) => part.text ).join( ';' ) }}`
					: '',
				others.length ? `${ others.join( ', ' ) } {${ rule.body }}` : '',
			]
				.filter( Boolean )
				.join( '\n' );
			const end = ! replacement && out[ rule.end ] === '\n' ? rule.end + 1 : rule.end;
			out = out.slice( 0, rule.start ) + replacement + out.slice( end );
		}
		css.push( ...found );
		return out;
	} );
	return css.length
		? { css: css.join( ' ' ), stylesheets: rewritten, kept: [ ...kept ] }
		: undefined;
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
	host: StudioAgentHost,
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
	const plan = planMove(
		sheets.map( ( sheet ) => sheet.css ),
		name,
		blockTypes
	);
	const styled = markup.map( ( item ) => ( {
		...item,
		styled: withBlockStyle( item.content, name ),
	} ) );
	if (
		! plan ||
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
			await saveMarkup( host, siteRoot, item, item.styled! );
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
				styles: { css: plan.css },
			},
			null,
			'\t'
		) + '\n',
		'utf8'
	);
	const moved = [];
	for ( const [ i, sheet ] of sheets.entries() ) {
		const rest = plan.stylesheets[ i ];
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
	) } into the style's "styles": { "css" }, as they were${
		plan.kept.length
			? ` (the class's rules keep ${ plan.kept.join(
					', '
			  ) }, which a rule left in place, as in a media query, also sets)`
			: ''
	}, and the blocks in ${ places.join(
		', '
	) } carry "is-style-${ name }" beside "${ name }", so they render as before. A block takes the look as "className":"is-style-${ name }"; the style's "styles" can hold each property at its path (WP_Theme_JSON::PROPERTIES_METADATA in wp-includes/class-wp-theme-json.php).`;
}
