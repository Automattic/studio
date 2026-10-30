/**
 * Links to sections of the front page that work on the front page only. A
 * navigation link prints its "url" as its href
 * (render_block_core_navigation_link() in wp-includes/blocks/navigation-link.php),
 * as a paragraph or button prints the href in its HTML, and an href of only
 * "#id" resolves against the address of the page it is on, so a link every
 * page shows, as a header or footer template part's are, takes a visitor on
 * any other page to an id that page does not have. Studio renders the front
 * page and another page as a visitor gets them, and where a link both render
 * names a section of the front page the other page lacks, links it to the
 * front page's section, as the link does on the front page itself: a
 * navigation link wherever it is held, and a link in a template part's HTML.
 */
import path from 'path';
import {
	readRenderedVersions,
	renderFrontPage,
	renderPage,
	type RenderedPage,
} from '@studio/agent/node/front-page-render';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { siteMarkup, saveMarkup, placeOf } from '@studio/agent/node/site-markup';
import { isUpdatableTheme } from '@studio/agent/node/themes';
import type { SiteChangeSource } from '@studio/agent/node/site-changes';

const escape = ( url: string ) => url.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );

// A navigation link or submenu block's comment whose url is `url`.
const linkTo = ( url: string ) =>
	new RegExp(
		`(<!--\\s+wp:navigation-(?:link|submenu)\\s+\\{(?:(?!-->)[\\s\\S])*?"url":")${ escape(
			url
		) }(")`,
		'g'
	);

// A link's href of `url`, in a block's HTML.
const hrefTo = ( url: string ) =>
	new RegExp( `(<a\\s(?:[^>]*?\\s)?href=")${ escape( url ) }(")`, 'g' );

// What the site renders, and which page is its front page: the options
// WP_Query::is_front_page() reads (wp-includes/class-wp-query.php), so a
// front page chosen after its sections and links were written is checked too.
const FRONT_PAGE_OPTIONS = [ 'show_on_front', 'page_on_front' ];
const readVersions = async ( sitePath: string ) => ( {
	...( await readRenderedVersions( sitePath ) ),
	...( await readWordPressSite( sitePath, ( site ) =>
		Object.fromEntries(
			FRONT_PAGE_OPTIONS.map( ( option ) => [ option, String( site.option( option ) ?? '' ) ] )
		)
	) ),
} );

export const sectionLinks: SiteChangeSource = {
	name: 'section links',
	saves: true,
	read: readVersions,
	async check( site, before, after, host ) {
		if ( Object.keys( after ).every( ( key ) => before[ key ] === after[ key ] ) ) {
			return { reports: [] };
		}
		let front: RenderedPage;
		let other: RenderedPage;
		try {
			front = await renderFrontPage( host, site );
			const sections = Object.keys( front.links ).filter( ( url ) =>
				front.ids.includes( url.slice( 1 ) )
			);
			if ( ! sections.length || ! front.other ) {
				return { reports: [] };
			}
			other = await renderPage( host, site, front.other );
		} catch {
			// A site WordPress cannot render for says nothing, as a failed note does.
			return { reports: [] };
		}
		// Links the other page renders too, as a template part's are, to a section
		// only the front page has.
		const broken = Object.keys( front.links ).filter(
			( url ) =>
				front.ids.includes( url.slice( 1 ) ) &&
				url in other.links &&
				! other.ids.includes( url.slice( 1 ) )
		);
		if ( ! broken.length ) {
			return { reports: [] };
		}
		const home = front.home;
		const themeDir =
			front.stylesheet && ! ( await isUpdatableTheme( site.path, front.stylesheet ) )
				? path.join( site.path, 'wp-content', 'themes', front.stylesheet )
				: undefined;
		const places: string[] = [];
		const fixed = new Set< string >();
		for ( const item of await siteMarkup( site.path, themeDir, {
			holding: '%#%',
		} ) ) {
			const part =
				item.type === 'wp_template_part' ||
				( item.file !== undefined && path.basename( path.dirname( item.file ) ) === 'parts' );
			let content = item.content;
			for ( const url of broken ) {
				let linked = content.replace( linkTo( url ), `$1${ home }${ url }$2` );
				// A template part renders on every page; a link in its HTML, as a
				// paragraph's or a button's, is its block's href.
				if ( part ) {
					linked = linked.replace( hrefTo( url ), `$1${ home }${ url }$2` );
				}
				if ( linked !== content ) {
					fixed.add( url );
					content = linked;
				}
			}
			if ( content !== item.content ) {
				await saveMarkup( host, site.path, item, content );
				places.push( placeOf( item, site.path ) );
			}
		}
		const named = ( urls: string[] ) =>
			urls
				.map( ( url ) => ( front.links[ url ] ? `"${ front.links[ url ] }" (${ url })` : url ) )
				.join( ', ' );
		const unfixed = broken.filter( ( url ) => ! fixed.has( url ) );
		const lead = `${ site.name }: links ${ named(
			broken
		) }, which the site's other pages render too, link to sections of the front page, and an href of only "#id" goes to that id on the page it is on (a navigation link prints its url as its href, render_block_core_navigation_link() in wp-includes/blocks/navigation-link.php), which the site's other pages do not have`;
		return {
			reports: [
				{
					key: 'section links',
					summary: fixed.size
						? `${ lead }. Studio linked ${ named( [
								...fixed,
						  ] ) } to the front page's section (${ home }#id), as they do on the front page, in ${ places.join(
								', '
						  ) }.`
						: undefined,
					problem: unfixed.length
						? `${ lead }. Link ${ named( unfixed ) } to the front page's section: ${ unfixed
								.map( ( url ) => `${ home }${ url }` )
								.join( ', ' ) }.`
						: undefined,
				},
			],
			next: places.length ? await readVersions( site.path ) : undefined,
		};
	},
};
