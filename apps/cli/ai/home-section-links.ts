/**
 * Links to a home page section that only work on the home page. A header or
 * footer template part renders on every page, so a bare `#features` in it
 * names an element of whichever page it is on. WordPress renders the site to
 * show which: the links a page other than the home page has, naming an
 * element that page lacks and the home page has, go nowhere there. A link to
 * an element every page renders, as a "Back to top" link is, works anywhere.
 */
import { getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';

// A post ID no site has, so WordPress renders its 404 template, which shows
// the header and footer as every page does (WP_Query sets is_404).
const NOT_FOUND = '?p=2147483647';

async function render( url: string ): Promise< string | undefined > {
	const response = await fetch( url, { signal: AbortSignal.timeout( 10_000 ) } ).catch(
		() => undefined
	);
	return response?.text().catch( () => undefined );
}

// The ids a page renders, which a fragment names (a block's anchor is its id).
function targets( html: string ): Set< string > {
	return new Set( [ ...html.matchAll( /\sid="([^"]+)"/g ) ].map( ( match ) => match[ 1 ] ) );
}

/** The problem with a site's home section links, while its server renders it. */
export async function homeSectionLinks( sitePath: string ): Promise< string | undefined > {
	const site = await getSiteByFolder( sitePath ).catch( () => undefined );
	if ( ! site ) {
		return undefined;
	}
	const url = getSiteUrl( site ).replace( /\/$/, '' );
	const [ home, other ] = await Promise.all( [
		render( `${ url }/` ),
		render( `${ url }/${ NOT_FOUND }` ),
	] );
	if ( ! home || ! other ) {
		return undefined;
	}
	const onHome = targets( home );
	const onOther = targets( other );
	const homeOnly = [
		...new Set( [ ...other.matchAll( /href="#([^"]+)"/g ) ].map( ( match ) => match[ 1 ] ) ),
	].filter( ( id ) => onHome.has( id ) && ! onOther.has( id ) );
	if ( ! homeOnly.length ) {
		return undefined;
	}
	const links = homeOnly.map( ( id ) => `#${ id }` ).join( ', ' );
	const fixed = homeOnly.map( ( id ) => `/#${ id }` ).join( ', ' );
	return `On every page of ${ url } but the home page, the links ${ links } go nowhere: they render on every page, as a header or footer template part does, and only the home page renders the sections they name. Write them ${ fixed }, so they reach the home page's sections from every page.`;
}
