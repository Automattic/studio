/**
 * A rendered page's layout as text, for a model that cannot view a
 * screenshot: where the browser put each region of the page (the block
 * theme's header, main and footer, and the blocks main holds) and whether the
 * page is wider than its viewport, measured after the page settles.
 */
import type { getSharedBrowser } from 'cli/ai/browser-utils';

type Browser = Awaited< ReturnType< typeof getSharedBrowser > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;

// Enough lines for a long page's sections without flooding the result.
const MAX_REGIONS = 40;

export function pageLayout( page: Page ): Promise< string[] > {
	return page.evaluate( ( maxRegions ) => {
		// Classes that name a block or the author's own, not the layout WordPress generates.
		const generated = /^(is-|has-|wp-container-|wp-elements-|wp-block-[a-z-]+-is-layout-)/;
		const label = ( element: Element ) =>
			element.tagName.toLowerCase() +
			( element.id ? `#${ element.id }` : '' ) +
			[ ...element.classList ]
				.filter( ( name ) => ! generated.test( name ) )
				.slice( 0, 3 )
				.map( ( name ) => `.${ name }` )
				.join( '' );
		const lines: string[] = [];
		let more = 0;
		const visit = ( parent: Element, depth: number ) => {
			for ( const element of parent.children ) {
				const rect = element.getBoundingClientRect();
				if ( rect.width === 0 || rect.height === 0 ) {
					continue;
				}
				if ( lines.length >= maxRegions ) {
					more++;
					continue;
				}
				const top = Math.round( rect.top + window.scrollY );
				lines.push(
					`${ '  '.repeat( depth ) }${ label( element ) }: y ${ top }–${
						top + Math.round( rect.height )
					} (${ Math.round( rect.height ) }px tall), x ${ Math.round( rect.left ) }–${ Math.round(
						rect.right
					) }`
				);
				// A region's blocks are a level down, past wrappers that hold one block.
				const wraps = ( box: Element ): Element =>
					box.children.length === 1 ? wraps( box.children[ 0 ] ) : box;
				if ( depth === 0 ) {
					visit( wraps( element ), 1 );
				}
			}
		};
		visit( document.querySelector( '.wp-site-blocks' ) ?? document.body, 0 );
		if ( more ) {
			lines.push( `…and ${ more } more` );
		}
		const width = document.documentElement.scrollWidth;
		if ( width > window.innerWidth ) {
			lines.push(
				`The page is ${ width }px wide in a ${ window.innerWidth }px viewport, so it scrolls sideways.`
			);
		}
		return lines;
	}, MAX_REGIONS );
}
