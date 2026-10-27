/**
 * Links on the home page that go nowhere. An href of only "#" is an empty
 * fragment, which the HTML standard resolves to the top of the page the link
 * is on, so a visitor who follows it stays where they are. A placeholder link
 * a pattern ships, or one written before its page existed, renders so: a
 * navigation link prints its url as its href
 * (render_block_core_navigation_link() in wp-includes/blocks/navigation-link.php).
 * When a call changes what the site renders, Studio fetches the home page as a
 * visitor gets it to show which links do, and where.
 */
import { readRenderedVersions } from 'cli/ai/block-render-check';
import { templatePart } from 'cli/ai/header-menu';
import { render } from 'cli/ai/home-section-links';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import type { SiteChangeSource } from 'cli/ai/site-changes';
import type { SiteData } from 'cli/lib/cli-config/core';

// A label as the visitor reads it, from the escaped HTML (esc_html()).
const decode = ( text: string ) =>
	text.replace( /&#0*39;|&#x0*27;/gi, "'" ).replace( /&amp;/g, '&' );

/** The problem with a site's links to nowhere, while its server renders it. */
async function linksToNowhere( site: SiteData ): Promise< string | undefined > {
	const url = `${ getSiteUrl( site ).replace( /\/$/, '' ) }/`;
	const html = await render( url );
	if ( ! html ) {
		return undefined;
	}
	const parts = ( [ 'header', 'footer' ] as const ).flatMap( ( tag ) => {
		const part = templatePart( html, tag );
		return part
			? [ { tag, start: html.indexOf( part ), end: html.indexOf( part ) + part.length } ]
			: [];
	} );
	const places = new Map< string, string[] >();
	for ( const link of html.matchAll( /<a\b[^>]*\bhref="#"[^>]*>([\s\S]*?)<\/a>/g ) ) {
		const at = link.index ?? 0;
		const part = parts.find( ( { start, end } ) => at >= start && at < end );
		const place = part ? `the ${ part.tag } template part` : "the page's content";
		const label = decode( link[ 1 ].replace( /<[^>]*>/g, '' ) )
			.replace( /\s+/g, ' ' )
			.trim();
		places.set( place, [
			...( places.get( place ) ?? [] ),
			label ? `"${ label }"` : 'one with no text',
		] );
	}
	if ( ! places.size ) {
		return undefined;
	}
	const where = [ ...places ].map(
		( [ place, labels ] ) => `${ labels.join( ', ' ) } in ${ place }`
	);
	return `On ${ url }, the links ${ where.join(
		'; '
	) } go nowhere: their href is only "#", an empty fragment, which takes a visitor to the top of the page they are on (a navigation link prints its url as its href, render_block_core_navigation_link() in wp-includes/blocks/navigation-link.php). Link each to the page or section it names, or take it out.`;
}

export const linksToNowhereChanges: SiteChangeSource = {
	name: 'links to nowhere',
	read: readRenderedVersions,
	async check( site, before, after ) {
		if ( Object.keys( after ).every( ( key ) => before[ key ] === after[ key ] ) ) {
			return { reports: [] };
		}
		return {
			reports: [
				{ key: 'links to nowhere', problem: await linksToNowhere( site ), atTurnEnd: true },
			],
		};
	},
};
