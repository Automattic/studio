/**
 * The look of a site built on a theme WordPress updates. Such a theme ships one
 * look for every site that uses it; a site has a look of its own only where
 * WordPress keeps one: its Global Styles (WP_Theme_JSON_Resolver::get_user_data()),
 * templates and parts saved for the theme (get_block_templates()), or a theme
 * of its own. When a call gives a site a static front page, or a front page on
 * another theme, and the site has none of these, Studio says so on the result,
 * once, with where WordPress keeps a site's own look, the theme template the
 * front page renders through and what it places around the page, and the page
 * templates the theme offers.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { readSavedCopies } from 'cli/ai/saved-copies';
import { readWordPressSite } from 'cli/ai/site-database';
import { themePresets } from 'cli/ai/theme-presets';
import { activeThemes, isUpdatableTheme, readThemeHeader } from 'cli/ai/themes';
import type { SiteChangeSource, Versions } from 'cli/ai/site-changes';

// The block templates WordPress looks for, in order, to render a static front
// page with its default template: get_front_page_template(), then
// get_page_template(), then the singular and index fallbacks (wp-includes/template.php).
const frontPageTemplates = ( slug: string, id: number ) => [
	'front-page',
	...( slug ? [ `page-${ slug }` ] : [] ),
	`page-${ id }`,
	'page',
	'singular',
	'index',
];

const readText = ( file: string ) => readFile( file, 'utf8' ).catch( () => undefined );

// The template the front page renders through, from the active theme or its
// parent, and what it places, in order: template parts, the title, the content.
async function frontPageFrame( root: string, themes: string[], slug: string, id: number ) {
	for ( const name of frontPageTemplates( slug, id ) ) {
		for ( const theme of themes ) {
			const markup = await readText(
				path.join( root, 'wp-content/themes', theme, 'templates', `${ name }.html` )
			);
			if ( markup === undefined ) {
				continue;
			}
			const places = [
				...markup.matchAll( /<!-- wp:(template-part|post-title|post-content)\b(\s+\{.*?\})?/g ),
			].map( ( [ , block, attributes ] ) =>
				block === 'template-part'
					? `the ${ ( JSON.parse( attributes ?? '{}' ) as { slug?: string } ).slug } part`
					: `the page's ${ block === 'post-title' ? 'title' : 'content' } (core/${ block })`
			);
			return { file: `${ theme }/templates/${ name }.html`, places };
		}
	}
	return undefined;
}

// The page templates the active theme and its parent offer (customTemplates in theme.json).
async function pageTemplates( root: string, themes: string[] ) {
	const offered = new Map< string, string >();
	for ( const theme of themes ) {
		const json = await readText( path.join( root, 'wp-content/themes', theme, 'theme.json' ) );
		const { customTemplates = [] } = JSON.parse( json ?? '{}' ) as {
			customTemplates?: { name: string; title?: string; postTypes?: string[] }[];
		};
		for ( const { name, title, postTypes = [ 'page' ] } of customTemplates ) {
			if ( postTypes.includes( 'page' ) && ! offered.has( name ) ) {
				offered.set( name, `${ title ?? name } (${ name })` );
			}
		}
	}
	return [ ...offered.values() ];
}

export const themeLook: SiteChangeSource = {
	name: 'theme-look',
	async read( sitePath ) {
		return readWordPressSite( sitePath, ( site ): Versions => {
			const [ theme ] = activeThemes( site );
			const front = Number( site.option( 'page_on_front' ) );
			// A front page on a theme, with nothing saved of the site's own.
			return theme &&
				site.option( 'show_on_front' ) === 'page' &&
				front &&
				! readSavedCopies( site ).length
				? { front: `page ${ front } on ${ theme }` }
				: {};
		} );
	},
	async check( site, before, after ) {
		if ( ! after.front || after.front === before.front ) {
			return { reports: [] };
		}
		const look = await readWordPressSite( site.path, async ( wp ) => {
			const [ theme ] = activeThemes( wp );
			if ( ! ( await isUpdatableTheme( site.path, theme ) ) ) {
				return undefined;
			}
			const front = Number( wp.option( 'page_on_front' ) );
			const [ page ] = wp.query< { slug: string } >(
				`SELECT post_name AS slug FROM ${ wp.prefix }posts WHERE ID = ?`,
				front
			);
			const themes = activeThemes( wp );
			return {
				theme:
					( await readThemeHeader( site.path, theme, 'Theme Name' ).catch( () => '' ) ) || theme,
				front,
				variations: ( await themePresets( wp ) )?.styleVariations ?? [],
				frame: await frontPageFrame( site.path, themes, page?.slug ?? '', front ),
				templates: await pageTemplates( site.path, themes ),
			};
		} );
		if ( ! look ) {
			return { reports: [] };
		}
		const { theme, front, variations, frame, templates } = look;
		const renders = frame
			? ` WordPress renders the front page through ${
					frame.file
			  } (the first the theme has of ${ frontPageTemplates( '<slug>', front ).join(
					', '
			  ) }; get_front_page_template() and get_page_template() in wp-includes/template.php)${
					frame.places.length ? `, which places ${ frame.places.join( ', then ' ) }` : ''
			  }.`
			: '';
		const offers = templates.length
			? ` ${ theme } also offers the page templates ${ templates.join( ', ' ) }.`
			: '';
		const styles = variations.length
			? `, as the Site Editor's Styles saves them, a style variation of ${ theme }'s (${ variations.join(
					', '
			  ) }) or styles of the site's own`
			: '';
		return {
			reports: [
				{
					key: `theme look ${ site.path } ${ after.front }`,
					summary: `The front page (page ${ front }) is built on ${ theme }, a theme WordPress updates, and the site has no Global Styles, templates or template parts saved of its own, so it looks as ${ theme } ships for every site that uses it. WordPress keeps a site's own look in its Global Styles${ styles } (WP_Theme_JSON_Resolver::get_user_data() in wp-includes/class-wp-theme-json-resolver.php), in templates and parts saved for the theme (get_block_templates() in wp-includes/block-template-utils.php), or in a theme of the site's own.${ renders }${ offers }`,
				},
			],
		};
	},
};
