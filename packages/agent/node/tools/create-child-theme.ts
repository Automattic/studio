import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { Type } from 'typebox';
import { readThemeHeader } from '@studio/agent/node/themes';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { runWpCli, textResult } from './utils';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

const exists = ( file: string ) =>
	stat( file ).then(
		() => true,
		() => false
	);

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

export const createChildThemeTool = defineTool(
	'create_child_theme',
	"Makes a child theme of a theme installed on a local site and activates it, so the site's own changes to that theme's look, templates and code live where its updates leave them. " +
		"Writes wp-content/themes/<slug>/style.css naming the parent as its Template, and, when the parent loads its stylesheet by the active theme's URI, a functions.php that loads the parent's. " +
		"WordPress reads each file the child lacks from the parent and merges the child's theme.json over the parent's, so the child holds only what it changes.",
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
		parent: Type.String( { description: "The parent theme's folder name, e.g. 'ollie'." } ),
		name: Type.String( { description: 'The child theme\'s name, e.g. "Fern & Field".' } ),
		slug: Type.Optional(
			Type.String( {
				description: "The child theme's folder name; from the name when not given.",
			} )
		),
	},
	async ( args, context ) => {
		const site = await context.host.sites.resolve( args.nameOrPath );
		const themes = path.join( site.path, 'wp-content/themes' );
		const parent = args.parent.trim();
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
				'The child theme needs a name, and a slug of lowercase letters, digits and dashes.'
			);
		}
		if ( ! SLUG.test( parent ) || ! ( await exists( path.join( themes, parent, 'style.css' ) ) ) ) {
			throw new Error(
				`No theme ${ parent } is installed on ${ site.name }: wp-content/themes/${ parent }/style.css is missing.`
			);
		}
		const grandparent = await readThemeHeader( site.path, parent, 'Template' );
		if ( grandparent ) {
			throw new Error(
				`${ parent } is a child theme of ${ grandparent }, and WordPress allows two generations: a child of a child theme gets the theme_parent_invalid error and no parent (WP_Theme::__construct() in wp-includes/class-wp-theme.php). Make the child theme of ${ grandparent }, or change ${ parent } itself if it is the site's own.`
			);
		}
		const dir = path.join( themes, slug );
		if ( await exists( dir ) ) {
			throw new Error( `wp-content/themes/${ slug } already exists. Choose another slug.` );
		}
		const parentName = ( await readThemeHeader( site.path, parent, 'Theme Name' ) ) || parent;
		await mkdir( dir, { recursive: true } );
		const written = [ 'style.css' ];
		await writeFile(
			path.join( dir, 'style.css' ),
			`/*\nTheme Name: ${ name }\nTemplate: ${ parent }\nDescription: A child theme of ${ parentName }.\nVersion: 1.0.0\nText Domain: ${ slug }\n*/\n`
		);
		if ( await loadsStylesheetOfActiveTheme( path.join( themes, parent ) ) ) {
			written.push( 'functions.php' );
			await writeFile(
				path.join( dir, 'functions.php' ),
				`<?php\n/**\n * ${ parentName } loads its stylesheet by the active theme's URI, which names this theme;\n * load ${ parentName }'s here.\n */\nadd_action(\n\t'wp_enqueue_scripts',\n\tfunction () {\n\t\twp_enqueue_style( '${ parent }-parent-style', get_template_directory_uri() . '/style.css', array(), wp_get_theme( get_template() )->get( 'Version' ) );\n\t},\n\t1\n);\n`
			);
		}
		await runWpCli( context.host, site, [ 'theme', 'activate', slug ] );
		return textResult(
			`Made ${ name }, a child theme of ${ parentName }, at wp-content/themes/${ slug }/ (${ written.join(
				', '
			) }), and activated it on ${
				site.name
			}. WordPress reads each file it lacks from ${ parent } and merges its theme.json over ${ parent }'s (WP_Theme_JSON_Resolver::get_theme_data() in wp-includes/class-wp-theme-json-resolver.php): add only what changes.`
		);
	},
	{ annotations: LOCAL_CHANGE }
);
