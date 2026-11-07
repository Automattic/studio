/**
 * Links on the home page that go nowhere. An href of only "#" is an empty
 * fragment, which the HTML standard resolves to the top of the page the link
 * is on, so a visitor who follows it stays where they are; a fragment no
 * element on the page has as its id or name indicates nothing, and following
 * it moves nothing (the HTML standard, "find a potential indicated element";
 * "top" is the top of the page). A placeholder link
 * a pattern ships, or one written before its page existed, renders so: a
 * navigation link prints its url as its href
 * (render_block_core_navigation_link() in wp-includes/blocks/navigation-link.php).
 * When a call changes what the site renders, Studio renders the home page as a
 * visitor gets it (front-page-render.ts) to show which links do, and where: those the site did not
 * have as Studio first saw it, or as a theme WordPress.org releases first
 * rendered it, whose links are the theme's design.
 */
import { readRenderedVersions, renderFrontPage } from '@studio/agent/node/front-page-render';
import { templatePart } from '@studio/agent/node/header-menu';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { isUpdatableTheme } from '@studio/agent/node/themes';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { SiteChangeSource } from '@studio/agent/node/site-changes';

// A label as the visitor reads it, from the escaped HTML (esc_html()).
const decode = ( text: string ) =>
	text.replace( /&#0*39;|&#x0*27;/gi, "'" ).replace( /&amp;/g, '&' );

interface NowhereLink {
	place: string;
	label: string;
	// The link as rendered: the same link on a later render.
	tag: string;
}

// A link as Studio first saw it: where it was, and as rendered.
type SeenLink = [ place: string, tag: string ];

/** A site's links to nowhere on its home page, as WordPress renders it. */
async function linksToNowhere(
	host: StudioAgentHost,
	site: HostSite
): Promise< { url: string; links: NowhereLink[] } | undefined > {
	const url = `${ site.url.replace( /\/$/, '' ) }/`;
	const html = await renderFrontPage( host, site ).then(
		( page ) => page.html,
		() => undefined
	);
	if ( ! html ) {
		return undefined;
	}
	const parts = ( [ 'header', 'footer' ] as const ).flatMap( ( tag ) => {
		const part = templatePart( html, tag );
		return part
			? [ { tag, start: html.indexOf( part ), end: html.indexOf( part ) + part.length } ]
			: [];
	} );
	const targets = new Set(
		[ ...html.matchAll( /<[a-z][^>]*?\s(?:id|name)="([^"]+)"/gi ) ].map( ( match ) => match[ 1 ] )
	);
	const links = [ ...html.matchAll( /<a\b[^>]*\bhref="#([^"]*)"[^>]*>([\s\S]*?)<\/a>/g ) ]
		.filter( ( [ , fragment ] ) => {
			const id = decode( fragment );
			return ! fragment || ( ! targets.has( id ) && id.toLowerCase() !== 'top' );
		} )
		.map( ( link ) => {
			const at = link.index ?? 0;
			const part = parts.find( ( { start, end } ) => at >= start && at < end );
			const place = part ? `the ${ part.tag } template part` : "the page's content";
			const text = decode( link[ 2 ].replace( /<[^>]*>/g, '' ) )
				.replace( /\s+/g, ' ' )
				.trim();
			const label = text ? `"${ text }"` : 'one with no text';
			return {
				place,
				label: link[ 1 ] ? `${ label } (#${ decode( link[ 1 ] ) })` : label,
				tag: link[ 0 ],
			};
		} );
	return { url, links };
}

/**
 * The links the site did not have as Studio first saw it: each first-seen link
 * accounts for one link, in its place first, then anywhere, so a link that
 * now renders elsewhere, as a template part's links do when its tag changes,
 * is the one the site had, and a link written again in another place is new.
 */
function unseen( links: NowhereLink[], seen: SeenLink[] ): NowhereLink[] {
	const left = [ ...seen ];
	const take = ( match: ( [ place, tag ]: SeenLink ) => boolean ) => {
		const at = left.findIndex( match );
		return at >= 0 && left.splice( at, 1 ).length > 0;
	};
	const elsewhere = links.filter(
		( link ) => ! take( ( [ place, tag ] ) => place === link.place && tag === link.tag )
	);
	return elsewhere.filter( ( link ) => ! take( ( [ , tag ] ) => tag === link.tag ) );
}

/** The problem with the links to nowhere a site did not have as Studio first saw it. */
async function newLinksToNowhere(
	host: StudioAgentHost,
	site: HostSite,
	seen: SeenLink[]
): Promise< string | undefined > {
	const found = await linksToNowhere( host, site );
	if ( ! found ) {
		return undefined;
	}
	const places = new Map< string, string[] >();
	for ( const { place, label } of unseen( found.links, seen ) ) {
		places.set( place, [ ...( places.get( place ) ?? [] ), label ] );
	}
	if ( ! places.size ) {
		return undefined;
	}
	const where = [ ...places ].map(
		( [ place, labels ] ) => `${ labels.join( ', ' ) } in ${ place }`
	);
	return `On ${ found.url }, the links ${ where.join(
		'; '
	) } go nowhere: an href of only "#" is an empty fragment, which takes a visitor to the top of the page they are on, and a fragment no element on the page has as its id moves them nowhere (a navigation link prints its url as its href, render_block_core_navigation_link() in wp-includes/blocks/navigation-link.php). Link each to the page, section or form it names, or take it out.`;
}

// The links to nowhere a site had as Studio first saw it, which are the user's
// site as it was, not the session's to raise, as OpenProblems keeps a site's
// problems as first seen.
const FIRST_SEEN = 'links to nowhere as first seen';
// The theme the site's templates come from (its parent's, for a child theme).
// When it becomes one WordPress.org releases and updates, the links the site
// then renders are added to those first seen: they are the released theme's,
// as its patterns ship them, not the session's.
const THEME = 'theme of the links to nowhere first seen';

export const linksToNowhereChanges: SiteChangeSource = {
	name: 'links to nowhere',
	async read( sitePath, last, host ) {
		const versions = await readRenderedVersions( sitePath );
		const theme = String(
			( await readWordPressSite( sitePath, ( site ) => site.option( 'template' ) ) ) ?? ''
		);
		const seen: SeenLink[] | undefined =
			last?.[ FIRST_SEEN ] !== undefined ? JSON.parse( last[ FIRST_SEEN ] ) : undefined;
		const released = async () =>
			last?.[ THEME ] !== theme && theme !== '' && ( await isUpdatableTheme( sitePath, theme ) );
		if ( seen && ! ( await released() ) ) {
			return { ...versions, [ FIRST_SEEN ]: last![ FIRST_SEEN ], [ THEME ]: theme };
		}
		const site = await host.sites.findByFolder( sitePath );
		const found = site ? await linksToNowhere( host, site ) : undefined;
		const added = unseen( found?.links ?? [], seen ?? [] ).map(
			( { place, tag } ): SeenLink => [ place, tag ]
		);
		return {
			...versions,
			[ FIRST_SEEN ]: JSON.stringify( [ ...( seen ?? [] ), ...added ] ),
			[ THEME ]: theme,
		};
	},
	async check( site, before, after, host ) {
		if ( Object.keys( after ).every( ( key ) => before[ key ] === after[ key ] ) ) {
			return { reports: [] };
		}
		const seen: SeenLink[] = JSON.parse( after[ FIRST_SEEN ] ?? '[]' );
		return {
			reports: [
				{
					key: 'links to nowhere',
					problem: await newLinksToNowhere( host, site, seen ),
					atTurnEnd: true,
				},
			],
		};
	},
};
