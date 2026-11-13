/**
 * A header that links to several of the site's pages, or of the home page's
 * sections, with no navigation. The
 * block that renders a menu is core/navigation: a <nav> landmark
 * (wp-includes/blocks/navigation.php) that the Site Editor edits as the
 * site's menu, as the header of WordPress's default theme holds it. One link
 * is a call to action; several, outside any navigation, are a menu built some
 * other way.
 *
 * Checked on the call that changes what the front page renders, so the agent
 * hears of it while it builds the header: in eval38 grooming port 1 it heard
 * at the end of its turn, after it had styled the links and summed up the
 * site, and took 4 calls more and a second summary.
 */
import { readRenderedVersions, renderFrontPage } from '@studio/agent/node/front-page-render';
import type { SiteChangeSource } from '@studio/agent/node/site-changes';
import type { HostSite, StudioAgentHost } from '@studio/agent/shared/host';

// A header or footer template part WordPress renders (wp-includes/blocks/template-part.php),
// to its own closing tag, past any element of the same tag inside it.
export function templatePart( html: string, tag: 'header' | 'footer' ): string | undefined {
	const start = html.search( new RegExp( `<${ tag }\\b[^>]*\\bwp-block-template-part\\b` ) );
	if ( start < 0 ) {
		return undefined;
	}
	const tags = new RegExp( `<(\\/?)${ tag }\\b`, 'g' );
	tags.lastIndex = start;
	let depth = 0;
	for ( let found = tags.exec( html ); found; found = tags.exec( html ) ) {
		depth += found[ 1 ] ? -1 : 1;
		if ( ! depth ) {
			return html.slice( start, found.index );
		}
	}
	return html.slice( start );
}

/** The problem with a site's header menu, on the front page WordPress renders. */
async function headerMenu( host: StudioAgentHost, site: HostSite ): Promise< string | undefined > {
	const url = site.url.replace( /\/$/, '' );
	const html = await renderFrontPage( host, site ).then(
		( page ) => page.html,
		() => undefined
	);
	const header = templatePart( html ?? '', 'header' );
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
	) } outside a core/navigation block, so the site has no menu: on a phone these links keep their desktop layout, where core/navigation collapses into a menu button (its overlayMenu, "mobile" by default, in wp-includes/blocks/navigation/block.json); screen readers find no <nav> landmark (wp-includes/blocks/navigation.php); and the Site Editor edits them as text rather than as the site's menu. Put these links in a core/navigation block in the header, with a core/navigation-link to each, and give the block their look with its typography and color settings.`;
}

// The problem as Studio first saw the site, which is the user's site as it
// was, not the session's to raise.
const FIRST_SEEN = 'header menu as first seen';

export const headerMenuChanges: SiteChangeSource = {
	name: 'header menu',
	async read( sitePath, last, host ) {
		const versions = await readRenderedVersions( sitePath );
		if ( last?.[ FIRST_SEEN ] !== undefined ) {
			return { ...versions, [ FIRST_SEEN ]: last[ FIRST_SEEN ] };
		}
		const site = await host.sites.findByFolder( sitePath );
		return { ...versions, [ FIRST_SEEN ]: ( site && ( await headerMenu( host, site ) ) ) ?? '' };
	},
	async check( site, before, after, host ) {
		if ( Object.keys( after ).every( ( key ) => before[ key ] === after[ key ] ) ) {
			return { reports: [] };
		}
		const problem = await headerMenu( host, site );
		return {
			reports: [
				{
					key: 'header menu',
					problem: problem === after[ FIRST_SEEN ] ? undefined : problem,
				},
			],
		};
	},
};
