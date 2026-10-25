/**
 * A header that links to several of the site's pages, or of the home page's
 * sections, with no navigation. The
 * block that renders a menu is core/navigation: a <nav> landmark
 * (wp-includes/blocks/navigation.php) that the Site Editor edits as the
 * site's menu, as the header of WordPress's default theme holds it. One link
 * is a call to action; several, outside any navigation, are a menu built some
 * other way.
 */
import { NOT_FOUND, render } from 'cli/ai/home-section-links';
import { getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';

// The header template part WordPress renders (wp-includes/blocks/template-part.php),
// to its own closing tag, past any header inside it.
function headerPart( html: string ): string | undefined {
	const start = html.search( /<header\b[^>]*\bwp-block-template-part\b/ );
	if ( start < 0 ) {
		return undefined;
	}
	const tags = /<(\/?)header\b/g;
	tags.lastIndex = start;
	let depth = 0;
	for ( let tag = tags.exec( html ); tag; tag = tags.exec( html ) ) {
		depth += tag[ 1 ] ? -1 : 1;
		if ( ! depth ) {
			return html.slice( start, tag.index );
		}
	}
	return html.slice( start );
}

/** The problem with a site's header menu, while its server renders it. */
export async function headerMenu( sitePath: string ): Promise< string | undefined > {
	const site = await getSiteByFolder( sitePath ).catch( () => undefined );
	if ( ! site ) {
		return undefined;
	}
	const url = getSiteUrl( site ).replace( /\/$/, '' );
	// Any page renders the header; one no post is renders only the template parts.
	const header = headerPart( ( await render( `${ url }/${ NOT_FOUND }` ) ) ?? '' );
	if ( ! header || /<nav\b/.test( header ) ) {
		return undefined;
	}
	const origin = new URL( url ).origin;
	const pages = new Set(
		[ ...header.matchAll( /<a\b[^>]*\bhref="([^"]*)"/g ) ]
			.map( ( match ) => new URL( match[ 1 ].replace( /&amp;/g, '&' ), `${ url }/` ) )
			.map( ( link ) => ( link.origin === origin ? link.pathname + link.hash : '/' ) )
			.filter( ( target ) => target !== '/' )
	);
	if ( pages.size < 2 ) {
		return undefined;
	}
	return `The header of ${ url } links to ${ [ ...pages ].join(
		', '
	) } with no navigation: core/navigation is the block that renders a site's menu, as a <nav> landmark the Site Editor edits as the menu (wp-includes/blocks/navigation.php), as the header of WordPress's default theme does. Put these links in a core/navigation block in the header, with a core/navigation-link to each.`;
}
