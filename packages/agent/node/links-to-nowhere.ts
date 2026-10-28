/**
 * Links on the home page that go nowhere. An href of only "#" is an empty
 * fragment, which the HTML standard resolves to the top of the page the link
 * is on, so a visitor who follows it stays where they are. A placeholder link
 * a pattern ships, or one written before its page existed, renders so: a
 * navigation link prints its url as its href
 * (render_block_core_navigation_link() in wp-includes/blocks/navigation-link.php).
 * When a call changes what the site renders, Studio fetches the home page as a
 * visitor gets it to show which links do, and where: those the site did not
 * have as Studio first saw it.
 */
import { readRenderedVersions } from '@studio/agent/node/block-render-check';
import { templatePart } from '@studio/agent/node/header-menu';
import { render } from '@studio/agent/node/page-render';
import type { HostSite } from '@studio/agent/node/host';
import type { SiteChangeSource } from '@studio/agent/node/site-changes';

// A label as the visitor reads it, from the escaped HTML (esc_html()).
const decode = ( text: string ) =>
	text.replace( /&#0*39;|&#x0*27;/gi, "'" ).replace( /&amp;/g, '&' );

interface NowhereLink {
	place: string;
	label: string;
	// The link as rendered, where it is: the same link on a later render.
	id: string;
}

/** A site's links to nowhere on its home page, while its server renders it. */
async function linksToNowhere(
	site: HostSite
): Promise< { url: string; links: NowhereLink[] } | undefined > {
	const url = `${ site.url.replace( /\/$/, '' ) }/`;
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
	const links = [ ...html.matchAll( /<a\b[^>]*\bhref="#"[^>]*>([\s\S]*?)<\/a>/g ) ].map(
		( link ) => {
			const at = link.index ?? 0;
			const part = parts.find( ( { start, end } ) => at >= start && at < end );
			const place = part ? `the ${ part.tag } template part` : "the page's content";
			const label = decode( link[ 1 ].replace( /<[^>]*>/g, '' ) )
				.replace( /\s+/g, ' ' )
				.trim();
			return {
				place,
				label: label ? `"${ label }"` : 'one with no text',
				id: `${ place } ${ link[ 0 ] }`,
			};
		}
	);
	return { url, links };
}

/** The problem with the links to nowhere a site did not have as Studio first saw it. */
async function newLinksToNowhere( site: HostSite, seen: string[] ): Promise< string | undefined > {
	const found = await linksToNowhere( site );
	if ( ! found ) {
		return undefined;
	}
	const places = new Map< string, string[] >();
	for ( const { place, label, id } of found.links ) {
		if ( ! seen.includes( id ) ) {
			places.set( place, [ ...( places.get( place ) ?? [] ), label ] );
		}
	}
	if ( ! places.size ) {
		return undefined;
	}
	const where = [ ...places ].map(
		( [ place, labels ] ) => `${ labels.join( ', ' ) } in ${ place }`
	);
	return `On ${ found.url }, the links ${ where.join(
		'; '
	) } go nowhere: their href is only "#", an empty fragment, which takes a visitor to the top of the page they are on (a navigation link prints its url as its href, render_block_core_navigation_link() in wp-includes/blocks/navigation-link.php). Link each to the page or section it names, or take it out.`;
}

// The links to nowhere a site had as Studio first saw it, which are the user's
// site as it was, not the session's to raise, as OpenProblems keeps a site's
// problems as first seen.
const FIRST_SEEN = 'links to nowhere as first seen';

export const linksToNowhereChanges: SiteChangeSource = {
	name: 'links to nowhere',
	async read( sitePath, last, host ) {
		const versions = await readRenderedVersions( sitePath );
		if ( last?.[ FIRST_SEEN ] !== undefined ) {
			return { ...versions, [ FIRST_SEEN ]: last[ FIRST_SEEN ] };
		}
		const site = await host.sites.findByFolder( sitePath );
		const found = site ? await linksToNowhere( site ) : undefined;
		return {
			...versions,
			[ FIRST_SEEN ]: JSON.stringify( found?.links.map( ( { id } ) => id ) ?? [] ),
		};
	},
	async check( site, before, after ) {
		if ( Object.keys( after ).every( ( key ) => before[ key ] === after[ key ] ) ) {
			return { reports: [] };
		}
		const seen: string[] = JSON.parse( after[ FIRST_SEEN ] ?? '[]' );
		return {
			reports: [
				{
					key: 'links to nowhere',
					problem: await newLinksToNowhere( site, seen ),
					atTurnEnd: true,
				},
			],
		};
	},
};
