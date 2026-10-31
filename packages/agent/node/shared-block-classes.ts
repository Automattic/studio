/**
 * The classes a theme's stylesheets give a look that several blocks of one
 * type share. WordPress's form for that look is a block style: a theme's
 * styles/blocks/<slug>.json names its blockTypes, WordPress registers it
 * (WP_Theme_JSON_Resolver::get_style_variations() in
 * wp-includes/class-wp-theme-json-resolver.php,
 * wp_register_block_style_variations_from_theme_json_partials() in
 * wp-includes/block-supports/block-style-variations.php), the block's Styles
 * panel offers it, and Global Styles edits it, as Twenty Twenty-Five's are.
 * Studio moves such a look into a block style when it can do so as it renders
 * (block-style-move.ts), and says where one belongs when it cannot.
 */
import { readFileSync } from 'fs';
import { readdir } from 'fs/promises';
import path from 'path';
import { moveToBlockStyle } from '@studio/agent/node/block-style-move';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { isBlockMarkup, type SiteFile } from '@studio/agent/node/site-file-guards';
import { siteMarkup } from '@studio/agent/node/site-markup';
import { themePresets } from '@studio/agent/node/theme-presets';
import type { StudioAgentHost } from '@studio/agent/node/host';

// The blocks of one type that carry a class before it reads as a shared look.
const SHARED = 3;

// The styles that place a block rather than give it a look.
const PLACEMENT = [ 'spacing', 'dimensions' ];

const BLOCK = /<!--\s+wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)\s+(\{.*?\})\s+\/?-->/g;

/** How many blocks of each type carry each class, `is-style-*` aside. */
export function blockClassCounts( markup: string[] ): Map< string, Map< string, number > > {
	const counts = new Map< string, Map< string, number > >();
	for ( const source of markup ) {
		for ( const [ , name, json ] of source.matchAll( BLOCK ) ) {
			let className: unknown;
			try {
				className = JSON.parse( json ).className;
			} catch {
				continue;
			}
			const type = name.includes( '/' ) ? name : `core/${ name }`;
			for ( const found of String( className ?? '' ).split( /\s+/ ) ) {
				if ( found && ! found.startsWith( 'is-style-' ) ) {
					const types = counts.get( found ) ?? new Map< string, number >();
					types.set( type, ( types.get( type ) ?? 0 ) + 1 );
					counts.set( found, types );
				}
			}
		}
	}
	return counts;
}

/** The properties each class is given by a rule of its own, as `.card`, `.card:hover` or `.wp-block-group.card`. */
export function classProperties( css: string ): Map< string, Set< string > > {
	const properties = new Map< string, Set< string > >();
	const withoutComments = css.replace( /\/\*[\s\S]*?\*\//g, '' );
	for ( const [ , selectors, declarations ] of withoutComments.matchAll(
		/([^{}]+)\{([^{}]*)\}/g
	) ) {
		for ( const selector of selectors.split( ',' ) ) {
			// The class alone, or beside a block's class (block-style-move.ts' blockClassName()).
			const own = selector
				.trim()
				.match(
					/^(?:\.wp-block-[a-z0-9-]+)?\.([A-Za-z0-9_-]+)(?:\.wp-block-[a-z0-9-]+)?(?::[a-z-]+)*$/
				);
			if ( ! own ) {
				continue;
			}
			const set = properties.get( own[ 1 ] ) ?? new Set< string >();
			for ( const declaration of declarations.split( ';' ) ) {
				const property = declaration.split( ':' )[ 0 ].trim().toLowerCase();
				if ( property && declaration.includes( ':' ) ) {
					set.add( property );
				}
			}
			properties.set( own[ 1 ], set );
		}
	}
	return properties;
}

async function themeFiles( dir: string, extensions: RegExp ): Promise< string[] > {
	const entries = await readdir( dir, { recursive: true, withFileTypes: true } ).catch( () => [] );
	return entries
		.filter( ( entry ) => entry.isFile() && extensions.test( entry.name ) )
		.map( ( entry ) => path.join( entry.parentPath, entry.name ) )
		.filter( ( file ) => ! file.includes( `${ path.sep }node_modules${ path.sep }` ) );
}

// theme.json's styles.css, which WordPress prints last of the global styles
// (WP_Theme_JSON::get_stylesheet() with 'custom-css' in
// wp-includes/class-wp-theme-json.php, wp_enqueue_global_styles() in
// wp-includes/script-loader.php).
function themeJsonCss( dir: string ): string {
	try {
		const css = JSON.parse( readFileSync( path.join( dir, 'theme.json' ), 'utf8' ) )?.styles?.css;
		return typeof css === 'string' ? css : '';
	} catch {
		return '';
	}
}

/**
 * Moves into a block style each look a write to a theme's stylesheet or block
 * markup leaves several blocks of one type sharing through a class, and says,
 * once a session for each class and block type, which of them it could not
 * move and where a block style's theme.json holds their properties.
 */
export function createSharedBlockClassNotes(
	host: StudioAgentHost
): ( siteFile: SiteFile ) => Promise< string[] > {
	const said = new Set< string >();
	return async ( siteFile ) => {
		const { siteRoot, theme } = siteFile;
		if (
			! theme ||
			! (
				theme.file.endsWith( '.css' ) ||
				theme.file === 'theme.json' ||
				isBlockMarkup( siteFile )
			)
		) {
			return [];
		}
		const stylesheets = await themeFiles( theme.dir, /\.css$/ );
		const styled = classProperties(
			[
				...stylesheets.map( ( file ) => readFileSync( file, 'utf8' ) ),
				themeJsonCss( theme.dir ),
			].join( '\n' )
		);
		if ( ! styled.size ) {
			return [];
		}
		const markup = () => siteMarkup( siteRoot, theme.dir, { holding: '%"className":%' } );
		const counts = blockClassCounts( ( await markup() ).map( ( item ) => item.content ) );
		const presets = await readWordPressSite( siteRoot, ( site ) =>
			themePresets( host, site, theme.slug )
		);
		if ( ! presets ) {
			return [];
		}
		const shared: string[] = [];
		const moves: string[] = [];
		const held = new Set< string >();
		for ( const [ found, properties ] of styled ) {
			const looks = [ ...properties ].filter( ( property ) => {
				const at = presets.styleProperties[ property ];
				return at && ! PLACEMENT.includes( at.split( '.' )[ 0 ] );
			} );
			const types = [ ...( counts.get( found ) ?? [] ) ];
			const sharedLook = looks.length && types.some( ( [ , blocks ] ) => blocks >= SHARED );
			const moved = sharedLook
				? await moveToBlockStyle(
						host,
						siteRoot,
						theme.dir,
						found,
						types.map( ( [ type ] ) => type ),
						stylesheets,
						await markup()
				  ).catch( () => undefined )
				: undefined;
			if ( moved ) {
				moves.push( moved );
				continue;
			}
			for ( const [ type, blocks ] of types ) {
				const key = `${ siteRoot } ${ found } ${ type }`;
				if ( blocks < SHARED || ! looks.length || said.has( key ) ) {
					continue;
				}
				said.add( key );
				shared.push( `\`.${ found }\` on ${ blocks } ${ type } (${ looks.join( ', ' ) })` );
				properties.forEach( ( property ) => held.add( property ) );
			}
		}
		if ( ! shared.length ) {
			return moves;
		}
		const paths = [ ...held ]
			.filter( ( property ) => presets.styleProperties[ property ] )
			.map( ( property ) => `${ property } ${ presets.styleProperties[ property ] }` );
		return [
			...moves,
			`The theme's stylesheets give a look to classes that several blocks of one type carry: ${ shared.join(
				', '
			) }. WordPress's form for a look blocks of one type share is a block style: ${ path.join(
				theme.dir,
				'styles',
				'blocks'
			) }/<slug>.json with "blockTypes", which WordPress registers (WP_Theme_JSON_Resolver::get_style_variations() in wp-includes/class-wp-theme-json-resolver.php), the block's Styles panel offers, and Global Styles edits, as Twenty Twenty-Five's are; a block takes it as "className":"is-style-<slug>". Its "styles" hold each property at its path (WP_Theme_JSON::PROPERTIES_METADATA in wp-includes/class-wp-theme-json.php): ${ paths.join(
				', '
			) }; anything else goes in "styles": { "css" } (WP_Theme_JSON::process_blocks_custom_css()), where \`&\` stands for the block.`,
		];
	};
}
