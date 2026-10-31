import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { Type } from 'typebox';
import { drawDesign } from '@studio/agent/node/design-catalog';
import { readThemeHeader } from '@studio/agent/node/themes';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { runWpCli, textResult } from './utils';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

const exists = ( file: string ) =>
	stat( file ).then(
		() => true,
		() => false
	);

const HEADER = '<!-- wp:template-part {"slug":"header"} /-->';
const FOOTER = '<!-- wp:template-part {"slug":"footer"} /-->';
const main = ( blocks: string ) =>
	`${ HEADER }\n\n<!-- wp:group {"tagName":"main","layout":{"type":"constrained"}} -->\n<main class="wp-block-group">${ blocks }</main>\n<!-- /wp:group -->\n\n${ FOOTER }\n`;
const part = ( blocks: string ) =>
	`<!-- wp:group {"layout":{"type":"constrained"}} -->\n<div class="wp-block-group">${ blocks }</div>\n<!-- /wp:group -->\n`;

/**
 * A block theme's structure, and none of its look: WordPress takes a theme
 * with templates/index.html as a block theme (WP_Theme::is_block_theme() in
 * wp-includes/class-wp-theme.php) and falls back to index.html for any
 * template the theme lacks (wp-includes/template.php); a page or post renders
 * through core/post-content (wp-includes/blocks/post-content.php); and a part
 * takes its header or footer area only from theme.json templateParts
 * (_add_block_template_part_area_info() in wp-includes/block-template-utils.php).
 */
const blockThemeFiles = ( name: string, slug: string ): Record< string, string > => ( {
	'style.css': `/*\nTheme Name: ${ name }\nDescription: The block theme of ${ name }.\nVersion: 1.0.0\nText Domain: ${ slug }\n*/\n`,
	'theme.json': `${ JSON.stringify(
		{
			$schema: 'https://schemas.wp.org/trunk/theme.json',
			version: 3,
			settings: {
				appearanceTools: true,
				layout: { contentSize: '720px', wideSize: '1200px' },
			},
			templateParts: [
				{ name: 'header', title: 'Header', area: 'header' },
				{ name: 'footer', title: 'Footer', area: 'footer' },
			],
		},
		null,
		'\t'
	) }\n`,
	'templates/index.html': main(
		'<!-- wp:query {"query":{"inherit":true}} -->\n<div class="wp-block-query"><!-- wp:post-template -->\n<!-- wp:post-title {"isLink":true} /-->\n\n<!-- wp:post-excerpt /-->\n<!-- /wp:post-template -->\n\n<!-- wp:query-no-results -->\n<!-- wp:paragraph -->\n<p>Nothing was found.</p>\n<!-- /wp:paragraph -->\n<!-- /wp:query-no-results --></div>\n<!-- /wp:query -->'
	),
	'templates/page.html': main( '<!-- wp:post-content {"layout":{"type":"constrained"}} /-->' ),
	'templates/single.html': main(
		'<!-- wp:post-title {"level":1} /-->\n\n<!-- wp:post-date /-->\n\n<!-- wp:post-content {"layout":{"type":"constrained"}} /-->'
	),
	'parts/header.html': part( '<!-- wp:site-title {"level":0} /-->' ),
	'parts/footer.html': part( '<!-- wp:site-title {"level":0} /-->' ),
} );

/**
 * Whether the parent loads its stylesheet by the active theme's URI:
 * get_stylesheet_uri() and get_stylesheet_directory_uri() name the child once
 * it is active (wp-includes/theme.php), so the parent's style.css stops loading.
 */
async function loadsStylesheetOfActiveTheme( parentDir: string ): Promise< boolean > {
	const files = await readdir( parentDir, { recursive: true } ).catch( () => [] as string[] );
	for ( const file of files.filter( ( name ) => name.endsWith( '.php' ) ) ) {
		const php = await readFile( path.join( parentDir, file ), 'utf8' ).catch( () => '' );
		if (
			/\bget_stylesheet_uri\s*\(|\bget_stylesheet_directory_uri\s*\(\s*\)\s*\.\s*['"]\/style\.css/.test(
				php
			)
		) {
			return true;
		}
	}
	return false;
}

/** A child theme's files: its style.css naming the parent, and a functions.php when the parent needs one. */
async function childThemeFiles(
	sitePath: string,
	themes: string,
	parent: string,
	name: string,
	slug: string,
	siteName: string
): Promise< { files: Record< string, string >; parentName: string } > {
	if ( ! SLUG.test( parent ) || ! ( await exists( path.join( themes, parent, 'style.css' ) ) ) ) {
		throw new Error(
			`No theme ${ parent } is installed on ${ siteName }: wp-content/themes/${ parent }/style.css is missing.`
		);
	}
	const grandparent = await readThemeHeader( sitePath, parent, 'Template' );
	if ( grandparent ) {
		throw new Error(
			`${ parent } is a child theme of ${ grandparent }, and WordPress allows two generations: a child of a child theme gets the theme_parent_invalid error and no parent (WP_Theme::__construct() in wp-includes/class-wp-theme.php). Make the child theme of ${ grandparent }, or change ${ parent } itself if it is the site's own.`
		);
	}
	const parentName = ( await readThemeHeader( sitePath, parent, 'Theme Name' ) ) || parent;
	const files: Record< string, string > = {
		'style.css': `/*\nTheme Name: ${ name }\nTemplate: ${ parent }\nDescription: A child theme of ${ parentName }.\nVersion: 1.0.0\nText Domain: ${ slug }\n*/\n`,
	};
	if ( await loadsStylesheetOfActiveTheme( path.join( themes, parent ) ) ) {
		files[
			'functions.php'
		] = `<?php\n/**\n * ${ parentName } loads its stylesheet by the active theme's URI, which names this theme;\n * load ${ parentName }'s here.\n */\nadd_action(\n\t'wp_enqueue_scripts',\n\tfunction () {\n\t\twp_enqueue_style( '${ parent }-parent-style', get_template_directory_uri() . '/style.css', array(), wp_get_theme( get_template() )->get( 'Version' ) );\n\t},\n\t1\n);\n`;
	}
	return { files, parentName };
}

export const createThemeTool = defineTool(
	'create_theme',
	'Makes a theme on a local site and activates it. ' +
		'Without a parent, a new block theme with its structure and none of its look: theme.json declaring the header and footer parts, templates/index.html, page.html and single.html around core/post-content, and parts/header.html and footer.html. ' +
		"With a parent, a child theme of that installed theme, so the site's own changes to its look, templates and code live where its updates leave them: style.css naming the parent as its Template, and, when the parent loads its stylesheet by the active theme's URI, a functions.php that loads the parent's.",
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
		name: Type.String( { description: 'The theme\'s name, e.g. "Fern & Field".' } ),
		parent: Type.Optional(
			Type.String( {
				description: "For a child theme, the parent theme's folder name, e.g. 'ollie'.",
			} )
		),
		slug: Type.Optional(
			Type.String( {
				description: "The theme's folder name; from the name when not given.",
			} )
		),
	},
	async ( args, context ) => {
		const site = await context.host.sites.resolve( args.nameOrPath );
		const themes = path.join( site.path, 'wp-content/themes' );
		const name = args.name.trim();
		const slug = (
			args.slug?.trim() ||
			name
				.toLowerCase()
				.replace( /[^a-z0-9]+/g, '-' )
				.replace( /^-+|-+$/g, '' )
		).trim();
		if ( ! name || ! SLUG.test( slug ) ) {
			throw new Error(
				'The theme needs a name, and a slug of lowercase letters, digits and dashes.'
			);
		}
		const parent = args.parent?.trim();
		const child = parent
			? await childThemeFiles( site.path, themes, parent, name, slug, site.name )
			: undefined;
		const dir = path.join( themes, slug );
		if ( await exists( dir ) ) {
			throw new Error( `wp-content/themes/${ slug } already exists. Choose another slug.` );
		}
		const files = child?.files ?? blockThemeFiles( name, slug );
		for ( const [ file, content ] of Object.entries( files ) ) {
			await mkdir( path.dirname( path.join( dir, file ) ), { recursive: true } );
			await writeFile( path.join( dir, file ), content );
		}
		await runWpCli( context.host, site, [ 'theme', 'activate', slug ] );
		const written = Object.keys( files ).join( ', ' );
		// The files as written, which the agent edits next rather than reads.
		const contents = Object.entries( files ).map(
			( [ file, content ] ) =>
				`wp-content/themes/${ slug }/${ file }:\n~~~\n${ content.trimEnd() }\n~~~`
		);
		const { look, layout } = drawDesign();
		const design = child
			? []
			: [
					"Studio drew this site's look and layout at random from its design catalogs, so one site differs from the next; a look or layout the user's request names takes the place of the one drawn.",
					`Look: ${ look.name }. ${ look.description }\n${ look.details }`,
					`Layout: ${ layout.name }. ${ layout.description }\n${ layout.details }`,
			  ];
		return textResult(
			[
				child
					? `Made ${ name }, a child theme of ${ child.parentName }, at wp-content/themes/${ slug }/ (${ written }), and activated it on ${ site.name }. WordPress reads each file it lacks from ${ parent } and merges its theme.json over ${ parent }'s (WP_Theme_JSON_Resolver::get_theme_data() in wp-includes/class-wp-theme-json-resolver.php): add only what changes. A \`file:\` path in its theme.json resolves to its own file, or else the parent's (get_theme_file_uri()).`
					: `Made ${ name }, a block theme, at wp-content/themes/${ slug }/ (${ written }), and activated it on ${ site.name }. It has a structure and no look yet: its palette, fonts and styles go in theme.json, its header and footer in its parts. WordPress renders any template it lacks, such as archive or 404, with templates/index.html (wp-includes/template.php).`,
				...design,
				...contents,
			].join( '\n\n' )
		);
	},
	{ annotations: LOCAL_CHANGE }
);
