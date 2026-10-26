/**
 * The classes a theme's stylesheets give a look that several blocks of one
 * type share. WordPress's form for that look is a block style: a theme's
 * styles/blocks/<slug>.json names its blockTypes, WordPress registers it
 * (WP_Theme_JSON_Resolver::get_style_variations() in
 * wp-includes/class-wp-theme-json-resolver.php,
 * wp_register_block_style_variations_from_theme_json_partials() in
 * wp-includes/block-supports/block-style-variations.php), the block's Styles
 * panel offers it, and Global Styles edits it, as Twenty Twenty-Five's are.
 */
import { readFileSync } from 'fs';
import { readdir } from 'fs/promises';
import path from 'path';
import { readWordPressSite } from 'cli/ai/site-database';
import { isBlockMarkup, type SiteFile } from 'cli/ai/site-file-guards';
import { themePresets } from 'cli/ai/theme-presets';

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

/** The properties each class is given by a rule of its own, as `.card` or `.card:hover`. */
export function classProperties( css: string ): Map< string, Set< string > > {
	const properties = new Map< string, Set< string > >();
	const withoutComments = css.replace( /\/\*[\s\S]*?\*\//g, '' );
	for ( const [ , selectors, declarations ] of withoutComments.matchAll(
		/([^{}]+)\{([^{}]*)\}/g
	) ) {
		for ( const selector of selectors.split( ',' ) ) {
			const own = selector.trim().match( /^\.([A-Za-z0-9_-]+)(?::[a-z-]+)*$/ );
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

/**
 * Says, once a session for each class and block type, which classes a write
 * to a theme's stylesheet or block markup leaves styling a look that several
 * blocks of one type share, and where a block style's theme.json holds their
 * properties.
 */
export function createSharedBlockClassNotes(): ( siteFile: SiteFile ) => Promise< string[] > {
	const said = new Set< string >();
	return async ( siteFile ) => {
		const { siteRoot, theme } = siteFile;
		if ( ! theme || ! ( theme.file.endsWith( '.css' ) || isBlockMarkup( siteFile ) ) ) {
			return [];
		}
		const stylesheets = await themeFiles( theme.dir, /\.css$/ );
		const styled = classProperties(
			stylesheets.map( ( file ) => readFileSync( file, 'utf8' ) ).join( '\n' )
		);
		if ( ! styled.size ) {
			return [];
		}
		const templates = ( await themeFiles( theme.dir, /\.(html|php)$/ ) ).filter( ( file ) =>
			/^(templates|parts|patterns)$/.test( path.basename( path.dirname( file ) ) )
		);
		const saved = await readWordPressSite( siteRoot, ( site ) =>
			site
				.query< { content: string } >(
					`SELECT post_content AS content FROM ${ site.prefix }posts WHERE post_status = 'publish' AND post_content LIKE '%"className":%'`
				)
				.map( ( row ) => row.content )
		);
		const counts = blockClassCounts( [
			...templates.map( ( file ) => readFileSync( file, 'utf8' ) ),
			...saved,
		] );
		const presets = await readWordPressSite( siteRoot, themePresets );
		if ( ! presets ) {
			return [];
		}
		const shared: string[] = [];
		const held = new Set< string >();
		for ( const [ found, properties ] of styled ) {
			const looks = [ ...properties ].filter( ( property ) => {
				const at = presets.styleProperties[ property ];
				return at && ! PLACEMENT.includes( at.split( '.' )[ 0 ] );
			} );
			for ( const [ type, blocks ] of counts.get( found ) ?? [] ) {
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
			return [];
		}
		const paths = [ ...held ]
			.filter( ( property ) => presets.styleProperties[ property ] )
			.map( ( property ) => `${ property } ${ presets.styleProperties[ property ] }` );
		return [
			`The theme's stylesheets give a look to classes that several blocks of one type carry: ${ shared.join(
				', '
			) }. WordPress's form for a look blocks of one type share is a block style: ${ path.join(
				theme.dir,
				'styles',
				'blocks'
			) }/<slug>.json with "blockTypes", which WordPress registers (WP_Theme_JSON_Resolver::get_style_variations() in wp-includes/class-wp-theme-json-resolver.php), the block's Styles panel offers, and Global Styles edits, as Twenty Twenty-Five's are; a block takes it as "className":"is-style-<slug>". Its "styles" hold each property at its path (WP_Theme_JSON::PROPERTIES_METADATA in wp-includes/class-wp-theme-json.php): ${ paths.join(
				', '
			) }; anything else goes in its "css".`,
		];
	};
}
