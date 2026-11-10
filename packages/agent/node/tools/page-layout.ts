/**
 * A rendered page's layout as text, for a model that cannot view a
 * screenshot: where the browser put each region of the page (the block
 * theme's header, main and footer, and the blocks main holds) and whether the
 * page is wider than its viewport, measured after the page settles.
 */
import { boundedLines } from '@studio/agent/node/bounded-list';
import type { getSharedBrowser } from '@studio/agent/node/browser-utils';

type Browser = Awaited< ReturnType< typeof getSharedBrowser > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;

// Enough lines for a long page's sections without flooding the result.
const MAX_REGIONS = 40;
// The elements named as making a page wider than its viewport.
const MAX_CAUSES = 5;

export async function pageLayout( page: Page ): Promise< string[] > {
	const regions = page.evaluate( () => {
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
		// Where a block's text sits across it, as a model that cannot see the
		// page cannot tell "centered" from "left" by the boxes alone: each text's
		// line farthest from the middle of what holds it (its column or group,
		// or in a row of blocks laid side by side its item, and the row's items
		// together in what holds the row), left, centered or right of it. A line
		// as wide as what holds it is placed by the box, not by its text.
		const placement = ( block: Element ) => {
			const middle = ( box: { left: number; right: number } ) => ( box.left + box.right ) / 2;
			const isRow = ( box: Element ) => {
				const style = getComputedStyle( box );
				return (
					style.display.endsWith( 'flex' ) &&
					style.flexDirection.startsWith( 'row' ) &&
					! box.classList.contains( 'wp-block-columns' )
				);
			};
			const TEXT = 'p, h1, h2, h3, h4, h5, h6, li, figcaption';
			const counts = { left: 0, centered: 0, right: 0 };
			const off: { side: 'left' | 'right'; text: string; px: number }[] = [];
			for ( const el of block.querySelectorAll( `${ TEXT }, a` ) ) {
				const text = ( el.textContent ?? '' ).replace( /\s+/g, ' ' ).trim();
				const box = el.getBoundingClientRect();
				// A link is measured with the text that holds it, a list item's text with the item.
				const outer = el.parentElement?.closest( TEXT );
				if ( ! text || ! box.width || ! box.height || ( outer && block.contains( outer ) ) ) {
					continue;
				}
				// The outermost row in the block holding it, as a row's items are placed together.
				let row: Element | undefined;
				for ( let at = el.parentElement; at && block.contains( at ); at = at.parentElement ) {
					if ( isRow( at ) ) {
						row = at;
					}
				}
				if ( isRow( el ) && ! row ) {
					row = el;
				}
				const item =
					row &&
					( row === el
						? undefined
						: [ ...row.children ].find( ( child ) => child.contains( el ) ) );
				const holder = ( item === el ? el : el.parentElement )?.getBoundingClientRect();
				if ( ! holder ) {
					continue;
				}
				const offsets: number[] = [];
				if ( row !== el ) {
					const range = document.createRange();
					range.selectNodeContents( el );
					const lines = new Map< number, { left: number; right: number } >();
					for ( const rect of range.getClientRects() ) {
						if ( rect.width ) {
							const top = Math.round( rect.top + rect.height / 2 );
							const line = lines.get( top ) ?? { left: rect.left, right: rect.right };
							lines.set( top, {
								left: Math.min( line.left, rect.left ),
								right: Math.max( line.right, rect.right ),
							} );
						}
					}
					for ( const line of lines.values() ) {
						if ( line.right - line.left < holder.width - 16 ) {
							offsets.push( middle( line ) - middle( holder ) );
						}
					}
				}
				// A row's content, its items' boxes and loose text together, in what holds the row.
				const rowHolder = row?.parentElement;
				if ( row && rowHolder ) {
					const range = document.createRange();
					range.selectNodeContents( row );
					const content = range.getBoundingClientRect();
					if ( content.width ) {
						offsets.push( middle( content ) - middle( rowHolder.getBoundingClientRect() ) );
					}
				}
				if ( ! offsets.length ) {
					continue;
				}
				const farthest = Math.round(
					offsets.reduce( ( a, b ) => ( Math.abs( b ) > Math.abs( a ) ? b : a ) )
				);
				if ( Math.abs( farthest ) <= 8 ) {
					counts.centered++;
				} else {
					const side = farthest < 0 ? 'left' : 'right';
					counts[ side ]++;
					off.push( {
						side,
						text: text.length > 30 ? `${ text.slice( 0, 30 ) }…` : text,
						px: Math.abs( farthest ),
					} );
				}
			}
			const kinds = ( [ 'left', 'centered', 'right' ] as const ).filter(
				( kind ) => counts[ kind ]
			);
			if ( ! kinds.length ) {
				return '';
			}
			// Named, when most of the block's text is centered: the text that is not.
			const named =
				counts.centered >= counts.left + counts.right
					? off.slice( 0, 3 ).map( ( item ) => `"${ item.text }" ${ item.px }px ${ item.side }` )
					: [];
			return `; text ${ kinds.map( ( kind ) => `${ counts[ kind ] } ${ kind }` ).join( ', ' ) }${
				named.length ? ` (${ named.join( ', ' ) })` : ''
			}`;
		};
		const lines: string[] = [];
		// A region's blocks are a level down, past wrappers that hold one block.
		const wraps = ( box: Element ): Element =>
			box.children.length === 1 ? wraps( box.children[ 0 ] ) : box;
		const visit = ( parent: Element, depth: number ) => {
			for ( const element of parent.children ) {
				const rect = element.getBoundingClientRect();
				if ( rect.width === 0 || rect.height === 0 ) {
					continue;
				}
				const top = Math.round( rect.top + window.scrollY );
				lines.push(
					`${ '  '.repeat( depth ) }${ label( element ) }: y ${ top }–${
						top + Math.round( rect.height )
					} (${ Math.round( rect.height ) }px tall), x ${ Math.round( rect.left ) }–${ Math.round(
						rect.right
					) }${ depth > 0 ? placement( element ) : '' }`
				);
				if ( depth === 0 ) {
					visit( wraps( element ), 1 );
				}
			}
		};
		visit( document.querySelector( '.wp-site-blocks' ) ?? document.body, 0 );
		return lines;
	} );
	return [
		...boundedLines( await regions, MAX_REGIONS ),
		...( await pageBandGaps( page ) ),
		...( await pageOverflow( page ) ),
	];
}

/**
 * Where the page's background shows as a strip between two full-width blocks
 * of the page, or of main, painted other than it at the edges that face each
 * other: the later block's top margin, as WordPress spaces each block after
 * the first in a layout by its block gap.
 */
export function pageBandGaps( page: Page ): Promise< string[] > {
	return page.evaluate( () => {
		const generated = /^(is-|has-|wp-container-|wp-elements-|wp-block-[a-z-]+-is-layout-)/;
		const label = ( element: Element ) =>
			element.tagName.toLowerCase() +
			[ ...element.classList ]
				.filter( ( name ) => ! generated.test( name ) )
				.slice( 0, 3 )
				.map( ( name ) => `.${ name }` )
				.join( '' );
		const viewport = document.documentElement.clientWidth;
		const transparent = ( color: string ) =>
			color === 'transparent' || /^rgba\(.*,\s*0\)$/.test( color );
		const shown = ( element: Element ) => element.getBoundingClientRect().height > 0;
		// What a block shows at its top or bottom edge: its own background, or
		// that of the block it starts or ends with.
		const edge = ( element: Element, side: 'top' | 'bottom' ): string | undefined => {
			const style = getComputedStyle( element );
			if ( style.backgroundImage !== 'none' || element.classList.contains( 'wp-block-cover' ) ) {
				return 'image';
			}
			if ( ! transparent( style.backgroundColor ) ) {
				return style.backgroundColor;
			}
			const children = [ ...element.children ].filter( shown );
			const child = side === 'top' ? children[ 0 ] : children[ children.length - 1 ];
			// Only a block that reaches the edge, past no padding, shows there.
			return child &&
				Math.abs(
					child.getBoundingClientRect()[ side ] - element.getBoundingClientRect()[ side ]
				) < 1
				? edge( child, side )
				: undefined;
		};
		const behind = ( element: Element ): string => {
			for ( let at: Element | null = element; at; at = at.parentElement ) {
				const color = getComputedStyle( at ).backgroundColor;
				if ( ! transparent( color ) ) {
					return color;
				}
			}
			return 'rgb(255, 255, 255)';
		};
		const gaps: { y: number; line: string }[] = [];
		const site = document.querySelector( '.wp-site-blocks' );
		const main = site?.querySelector( ':scope > main' );
		const wraps = ( box: Element ): Element =>
			box.children.length === 1 ? wraps( box.children[ 0 ] ) : box;
		for ( const parent of [ site, main && wraps( main ) ] ) {
			if ( ! parent ) {
				continue;
			}
			// Two blocks side by side in the flow, both full width: a narrower block
			// between two is what separates them, not the page's background.
			const blocks = [ ...parent.children ].filter( shown );
			const fullWidth = ( element: Element ) => {
				const rect = element.getBoundingClientRect();
				return rect.left <= 0 && rect.right >= viewport - 1;
			};
			const background = behind( parent );
			blocks.slice( 1 ).forEach( ( block, index ) => {
				const before = blocks[ index ];
				if ( ! fullWidth( before ) || ! fullWidth( block ) ) {
					return;
				}
				const bottom = before.getBoundingClientRect().bottom + window.scrollY;
				const gap = Math.round( block.getBoundingClientRect().top + window.scrollY - bottom );
				const faces = [ edge( before, 'bottom' ), edge( block, 'top' ) ];
				if (
					gap > 0 &&
					parseFloat( getComputedStyle( block ).marginTop ) > 0 &&
					faces.every( ( face ) => face && face !== background )
				) {
					gaps.push( {
						y: bottom,
						line: `y ${ Math.round( bottom ) }–${
							Math.round( bottom ) + gap
						} (${ gap }px), between ${ label( before ) } and ${ label( block ) }`,
					} );
				}
			} );
		}
		return gaps.length
			? [
					"The page's background shows as a strip between full-width blocks, the top margin WordPress gives each block after the first in a layout from its block gap (wp_get_layout_style() in wp-includes/block-supports/layout.php; for the header, main and footer, :where(.wp-site-blocks) > * in WP_Theme_JSON::get_root_layout_rules()):",
					...gaps.sort( ( a, b ) => a.y - b.y ).map( ( gap ) => `  ${ gap.line }` ),
			  ]
			: [];
	} );
}

/**
 * Each row of the header whose items take more than one line: a flex row
 * wraps an item that does not fit onto a line of its own, as WordPress's flex
 * layout and the navigation block let theirs: with the width its items need
 * on one line, each at its natural width with the row's gaps between them.
 */
export function pageHeaderWraps( page: Page ): Promise< string[] > {
	return page.evaluate( () => {
		const generated = /^(is-|has-|wp-container-|wp-elements-|wp-block-[a-z-]+-is-layout-)/;
		const label = ( element: Element ) =>
			element.tagName.toLowerCase() +
			[ ...element.classList ]
				.filter( ( name ) => ! generated.test( name ) )
				.slice( 0, 3 )
				.map( ( name ) => `.${ name }` )
				.join( '' );
		// What narrows the row, as pageTextFit() names what narrows a word's box:
		// the outermost ancestor too narrow to hold it, in the one that has room;
		// none when no ancestor has room, as the page's width is what limits it.
		const settingsLabel = ( element: Element ) =>
			element.tagName.toLowerCase() +
			[ ...element.classList ]
				.filter(
					( name ) =>
						! /^(has-|is-layout-|wp-container-|wp-elements-|wp-block-[a-z-]+-is-layout-)/.test(
							name
						)
				)
				.slice( 0, 3 )
				.map( ( name ) => `.${ name }` )
				.join( '' );
		const narrowedBy = ( box: Element, needed: number ) => {
			let narrow: Element | undefined;
			for (
				let at = box.parentElement;
				at && at !== document.body && at !== document.documentElement;
				at = at.parentElement
			) {
				const style = getComputedStyle( at );
				if ( style.display === 'inline' || style.display === 'contents' ) {
					continue;
				}
				const room =
					at.clientWidth - parseFloat( style.paddingLeft ) - parseFloat( style.paddingRight );
				if ( room >= needed ) {
					return narrow ? ` in ${ settingsLabel( narrow ) } in ${ settingsLabel( at ) }` : '';
				}
				narrow = at;
			}
			return '';
		};
		// The width a row's items take on one line, each at its natural width: the
		// row laid out at its max-content width, as wide as its items on one line
		// with its gaps between them, and put back at once, before the browser
		// paints. Not the items' boxes as laid out, as a wrapping row shrinks an
		// item whose text wraps to the row's width.
		const oneLine = ( row: HTMLElement ) => {
			const saved = row.getAttribute( 'style' );
			for ( const [ name, value ] of [
				[ 'width', 'max-content' ],
				[ 'min-width', '0' ],
				[ 'max-width', 'none' ],
				[ 'flex', 'none' ],
				[ 'box-sizing', 'content-box' ],
			] ) {
				row.style.setProperty( name, value, 'important' );
			}
			const style = getComputedStyle( row );
			const width = parseFloat( style.width );
			if ( saved === null ) {
				row.removeAttribute( 'style' );
			} else {
				row.setAttribute( 'style', saved );
			}
			return width;
		};
		const header = document.querySelector( '.wp-site-blocks > header' );
		const lines: string[] = [];
		for ( const row of header ? [ header, ...header.querySelectorAll( '*' ) ] : [] ) {
			const style = getComputedStyle( row );
			if ( ! /flex$/.test( style.display ) || ! style.flexDirection.startsWith( 'row' ) ) {
				continue;
			}
			const items = [ ...row.children ].filter(
				( item ) =>
					item.getBoundingClientRect().height > 0 &&
					! [ 'absolute', 'fixed' ].includes( getComputedStyle( item ).position )
			);
			// An item starts a line when it starts below every item of the one before.
			const starts: Element[] = [];
			let bottom = -Infinity;
			for ( const item of items ) {
				const rect = item.getBoundingClientRect();
				if ( rect.top >= bottom - 1 ) {
					starts.push( item );
					bottom = rect.bottom;
				} else {
					bottom = Math.max( bottom, rect.bottom );
				}
			}
			if ( starts.length < 2 ) {
				continue;
			}
			const text = ( item: Element ) => {
				const words = ( item.textContent ?? '' ).replace( /\s+/g, ' ' ).trim();
				return words
					? `"${ words.length > 40 ? `${ words.slice( 0, 40 ) }…` : words }"`
					: label( item );
			};
			const padding = parseFloat( style.paddingLeft ) + parseFloat( style.paddingRight );
			const room = row.clientWidth - padding;
			const needed = Math.round( oneLine( row as HTMLElement ) );
			const gap = parseFloat( style.columnGap ) || 0;
			const shortfall =
				needed > room
					? `; on one line they need ${ needed }px${
							gap ? `, with their ${ Math.round( gap ) }px gaps` : ''
					  }, ${ Math.round( needed - room ) }px more than the row has${ narrowedBy(
							row,
							needed + row.getBoundingClientRect().width - row.clientWidth + padding
					  ) }`
					: '';
			lines.push(
				`${ row === header ? 'The header' : `The header's ${ label( row ) }` } lays its ${
					items.length
				} items out in a row, ${ row.clientWidth }px wide, and they take ${
					starts.length
				} lines: ${ starts.slice( 1 ).map( text ).join( ', ' ) } ${
					starts.length > 2 ? 'start lines' : 'starts a line'
				} of ${
					starts.length > 2 ? 'their' : 'its'
				} own, as the row wraps the items that do not fit${ shortfall }.`
			);
		}
		return lines;
	} );
}

/** Whether the page is wider than its viewport, and the elements that make it so. */
export async function pageOverflow( page: Page ): Promise< string[] > {
	const { lines, causes } = await page.evaluate( () => {
		const generated = /^(is-|has-|wp-container-|wp-elements-|wp-block-[a-z-]+-is-layout-)/;
		// An element with no id or class of its own is named by its text, as one
		// link among many is.
		const label = ( element: Element, byText = true ) => {
			const tag = element.tagName.toLowerCase();
			const named =
				tag +
				( element.id ? `#${ element.id }` : '' ) +
				[ ...element.classList ]
					.filter( ( name ) => ! generated.test( name ) )
					.slice( 0, 3 )
					.map( ( name ) => `.${ name }` )
					.join( '' );
			const text = ( element.textContent ?? '' ).replace( /\s+/g, ' ' ).trim();
			return byText && named === tag && text
				? `${ tag } "${ text.length > 40 ? `${ text.slice( 0, 40 ) }…` : text }"`
				: named;
		};
		const lines: string[] = [];
		const width = document.documentElement.scrollWidth;
		if ( width <= window.innerWidth ) {
			return { lines, causes: [] };
		}
		lines.push(
			`The page is ${ width }px wide in a ${ window.innerWidth }px viewport, so it scrolls sideways.`
		);
		// What makes it wider: each element past the viewport whose parent is not.
		// A box that clips its overflow, or a fixed one, adds nothing to the page's width.
		// The page scrolls toward its end side only, so content past its start
		// edge (the left, unless the page is right to left) widens nothing.
		const viewport = document.documentElement.clientWidth;
		const rtl = getComputedStyle( document.documentElement ).direction === 'rtl';
		const past = ( element: Element ) => {
			const rect = element.getBoundingClientRect();
			return (
				rect.width > 0 && rect.height > 0 && ( rtl ? rect.left < -1 : rect.right > viewport + 1 )
			);
		};
		// Content that a box clips does not widen the page; a box's own clipping
		// counts for its text, not for the box itself.
		const widens = ( element: Element, clipsItself = false ) => {
			for (
				let box: Element | null = element;
				box && box !== document.body;
				box = box.parentElement
			) {
				const style = getComputedStyle( box );
				if (
					style.position === 'fixed' ||
					( ( clipsItself || box !== element ) && style.overflowX !== 'visible' )
				) {
					return false;
				}
			}
			return true;
		};
		const region = ( element: Element ) =>
			element.closest( 'header, main, footer, .wp-block-template-part' );
		const causes = [ ...document.body.querySelectorAll( '*' ) ].filter(
			( element ) =>
				past( element ) &&
				! (
					element.parentElement &&
					element.parentElement !== document.body &&
					past( element.parentElement )
				) &&
				widens( element )
		);
		const where = ( element: Element ) => {
			const within = region( element );
			return within && within !== element ? `, in ${ label( within, false ) }` : '';
		};
		const found = causes.map( ( element ) => {
			const rect = element.getBoundingClientRect();
			return `  ${ label( element ) } reaches past it, x ${ Math.round( rect.left ) }–${ Math.round(
				rect.right
			) }${ where( element ) }.`;
		} );
		// Text that does not wrap within its box spills past it, as a box's
		// overflow is visible by default, while the box itself fits.
		const walker = document.createTreeWalker( document.body, NodeFilter.SHOW_TEXT );
		const range = document.createRange();
		for ( let node = walker.nextNode(); node; node = walker.nextNode() ) {
			const element = node.parentElement;
			const text = ( node.textContent ?? '' ).replace( /\s+/g, ' ' ).trim();
			if (
				! element ||
				! text ||
				causes.some( ( cause ) => cause.contains( element ) ) ||
				! widens( element, true )
			) {
				continue;
			}
			range.selectNodeContents( node );
			const rects = [ ...range.getClientRects() ].filter( ( rect ) => rect.width > 0 );
			const left = Math.min( ...rects.map( ( rect ) => rect.left ) );
			const right = Math.max( ...rects.map( ( rect ) => rect.right ) );
			if ( ! rects.length || ( rtl ? left >= -1 : right <= viewport + 1 ) ) {
				continue;
			}
			// The box the text lays out in: an inline element, as a link, has none of its own.
			let box = element;
			while ( box.parentElement && getComputedStyle( box ).display === 'inline' ) {
				box = box.parentElement;
			}
			const quoted = text.length > 40 ? `${ text.slice( 0, 40 ) }…` : text;
			found.push(
				`  The text "${ quoted }" of ${ label( box, false ) } reaches past it, x ${ Math.round(
					left
				) }–${ Math.round( right ) }, wider than its ${
					box.clientWidth
				}px box, as the browser does not wrap it there${ where( box ) }.`
			);
		}
		return { lines, causes: found };
	} );
	return [ ...lines, ...boundedLines( causes, MAX_CAUSES, '  ' ) ];
}

// Enough lines to show where text does not fit without flooding the result.
const MAX_TEXT_LINES = 10;

/** Text against the viewport's edge, and words the browser breaks across lines. */
export interface TextFit {
	edges: string[];
	breaks: string[];
}

/**
 * Where a rendered page's text does not fit, as the browser lays it out: text
 * that starts or ends at the viewport's edge, and a word it breaks across
 * lines because the word is wider than its box (as the word-break and
 * overflow-wrap rules of core's block styles let it, in
 * wp-includes/css/dist/block-library/style.css). A word the page hyphenates
 * is not counted.
 */
export async function pageTextFit( page: Page ): Promise< TextFit > {
	const { edges, breaks } = await page.evaluate( () => {
		const generated = /^(is-|has-|wp-container-|wp-elements-|wp-block-[a-z-]+-is-layout-)/;
		// An element with no class of its own is named by its text, as one link among many is.
		const label = ( element: Element, byText = true ) => {
			const tag = element.tagName.toLowerCase();
			const named =
				tag +
				[ ...element.classList ]
					.filter( ( name ) => ! generated.test( name ) )
					.slice( 0, 2 )
					.map( ( name ) => `.${ name }` )
					.join( '' );
			const text = ( element.textContent ?? '' ).replace( /\s+/g, ' ' ).trim();
			return byText && named === tag && text
				? `${ tag } "${ text.length > 40 ? `${ text.slice( 0, 40 ) }…` : text }"`
				: named;
		};
		// A class many blocks share names no one of them, so the block is also named by its text.
		const quoted = ( element: Element ) => {
			const named = label( element );
			const text = ( ( element as HTMLElement ).innerText ?? '' ).replace( /\s+/g, ' ' ).trim();
			return named.includes( '"' ) || ! text
				? named
				: `${ named } "${ text.length > 40 ? `${ text.slice( 0, 40 ) }…` : text }"`;
		};
		// What makes a box too narrow for a word: the outermost of its ancestors
		// too narrow to hold the box at the word's width, named in the ancestor
		// that has room, as a column of a row of columns that does not stack on a
		// phone. Its classes include the ones naming a block's settings.
		const settingsLabel = ( element: Element ) =>
			element.tagName.toLowerCase() +
			[ ...element.classList ]
				.filter(
					( name ) =>
						! /^(has-|is-layout-|wp-container-|wp-elements-|wp-block-[a-z-]+-is-layout-)/.test(
							name
						)
				)
				.slice( 0, 3 )
				.map( ( name ) => `.${ name }` )
				.join( '' );
		const narrowedBy = ( box: HTMLElement, needed: number ) => {
			let narrow: Element | undefined;
			for (
				let at = box.parentElement;
				at && at !== document.body && at !== document.documentElement;
				at = at.parentElement
			) {
				const style = getComputedStyle( at );
				if ( style.display === 'inline' || style.display === 'contents' ) {
					continue;
				}
				const room =
					at.clientWidth - parseFloat( style.paddingLeft ) - parseFloat( style.paddingRight );
				if ( room >= needed ) {
					return narrow ? ` in ${ settingsLabel( narrow ) } in ${ settingsLabel( at ) }` : '';
				}
				narrow = at;
			}
			return narrow ? ` in ${ settingsLabel( narrow ) }` : '';
		};
		const edges: string[] = [];
		const breaks: string[] = [];
		const add = ( lines: string[], line: string ) => {
			if ( ! lines.includes( line ) ) {
				lines.push( line );
			}
		};
		const viewport = document.documentElement.clientWidth;
		const walker = document.createTreeWalker( document.body, NodeFilter.SHOW_TEXT );
		const range = document.createRange();
		for ( let node = walker.nextNode(); node; node = walker.nextNode() ) {
			const element = node.parentElement;
			const text = node.textContent ?? '';
			if ( ! element || ! text.trim() ) {
				continue;
			}
			const style = getComputedStyle( element );
			const shown = element.getBoundingClientRect();
			// Text a visitor does not see, as WordPress's screen-reader-text clips it to 1px.
			if (
				style.visibility === 'hidden' ||
				shown.height <= 1 ||
				element.closest( '[aria-hidden="true"]' )
			) {
				continue;
			}
			range.selectNodeContents( node );
			const rects = [ ...range.getClientRects() ].filter( ( rect ) => rect.width > 0 );
			if ( ! rects.length ) {
				continue;
			}
			const textLeft = Math.min( ...rects.map( ( rect ) => rect.left ) );
			const textRight = Math.max( ...rects.map( ( rect ) => rect.right ) );
			// What a visitor sees of the text: its box within each box that clips
			// it, its own and its ancestors', as an overflow: hidden band clips a
			// marquee's track, at the inside of its border. The page's root and
			// body clip at the viewport, the edge the text is judged by. A box
			// positioned absolutely escapes the clip of each ancestor up to the
			// positioned one it is placed in; a fixed one, every clip.
			let left = textLeft;
			let right = textRight;
			let clippedLeft = false;
			let clippedRight = false;
			let escapes = false;
			for (
				let at: Element | null = element;
				at && at !== document.body && at !== document.documentElement;
				at = at.parentElement
			) {
				const atStyle = getComputedStyle( at );
				const positioned = atStyle.position !== 'static' || atStyle.transform !== 'none';
				// Overflow does not apply to an inline box, as a link.
				if (
					( positioned || ! escapes ) &&
					atStyle.overflowX !== 'visible' &&
					atStyle.display !== 'inline'
				) {
					const clipLeft = at.getBoundingClientRect().left + at.clientLeft;
					const clipRight = clipLeft + at.clientWidth;
					if ( clipLeft > left ) {
						left = clipLeft;
						clippedLeft = true;
					}
					if ( clipRight < right ) {
						right = clipRight;
						clippedRight = true;
					}
				}
				if ( atStyle.position === 'fixed' ) {
					break;
				}
				escapes = atStyle.position === 'absolute' || ( escapes && ! positioned );
			}
			// Text a visitor cannot see on this screen: clipped away, or wholly
			// outside the viewport, as a form's honeypot field placed at x -9999.
			const visible = right > left && right > 0 && left < viewport;
			// A side its clip cuts runs the text under that clip's edge, not against the viewport's.
			if ( visible && left < 1 && ! clippedLeft ) {
				add(
					edges,
					`${ quoted( element ) }: its text starts at the viewport's left edge (x ${ Math.round(
						left
					) }).`
				);
			} else if ( visible && right > viewport - 1 && right <= viewport + 1 && ! clippedRight ) {
				add(
					edges,
					`${ quoted( element ) }: its text ends at the viewport's right edge (x ${ Math.round(
						right
					) }).`
				);
			}
			if ( style.hyphens === 'auto' ) {
				continue;
			}
			const partsOf = ( start: number, end: number ) => {
				range.setStart( node, start );
				range.setEnd( node, end );
				return [ ...range.getClientRects() ].filter( ( rect ) => rect.width > 0 );
			};
			// The browser breaks a run of letters only where the text around it, as
			// an email address, has no place to wrap, so it is that text that is too wide.
			for ( const match of text.matchAll( /\S+/g ) ) {
				const broken = [ ...match[ 0 ].matchAll( /[\p{L}\p{N}]+/gu ) ].some( ( run ) => {
					const start = match.index + run.index;
					const tops = partsOf( start, start + run[ 0 ].length ).map( ( rect ) =>
						Math.round( rect.top )
					);
					return new Set( tops ).size > 1;
				} );
				if ( broken ) {
					const parts = partsOf( match.index, match.index + match[ 0 ].length );
					const width = Math.round( parts.reduce( ( sum, rect ) => sum + rect.width, 0 ) );
					// The box the word wraps in: an inline element, as a link, has no width of its own.
					let box = element;
					while ( box.parentElement && getComputedStyle( box ).display === 'inline' ) {
						box = box.parentElement;
					}
					const padding =
						parseFloat( getComputedStyle( box ).paddingLeft ) +
						parseFloat( getComputedStyle( box ).paddingRight );
					add(
						breaks,
						`${
							( box as HTMLElement ).innerText?.trim() === match[ 0 ]
								? label( box, false )
								: quoted( box )
						}: the browser breaks "${
							match[ 0 ]
						}" across lines, as the word (${ width }px) is wider than its box (${ Math.round(
							box.clientWidth - padding
						) }px)${ narrowedBy( box, width + box.offsetWidth - box.clientWidth + padding ) }.`
					);
				}
			}
		}
		// Text against an edge of a block theme's page whose root padding is core's
		// 0px: what WordPress pads a page's content from the viewport's edges with.
		const body = getComputedStyle( document.body );
		const rootPadding = ( side: 'left' | 'right' ) =>
			parseFloat( body.getPropertyValue( `--wp--style--root--padding-${ side }` ) || '0' ) +
			parseFloat( body.getPropertyValue( `padding-${ side }` ) || '0' );
		if (
			edges.length &&
			document.querySelector( '.wp-site-blocks' ) &&
			rootPadding( 'left' ) === 0 &&
			rootPadding( 'right' ) === 0
		) {
			edges.unshift(
				"The theme's styles.spacing.padding, the padding WordPress puts between the page's content and the viewport's edges, is core's 0px (wp-includes/theme.json); with settings.useRootPaddingAwareAlignments true, WordPress applies it inside each .has-global-padding container, so full-width blocks still reach the edges (get_root_layout_rules() in wp-includes/class-wp-theme-json.php)."
			);
		}
		return { edges, breaks };
	} );
	return {
		edges: boundedLines( edges, MAX_TEXT_LINES ),
		breaks: boundedLines( breaks, MAX_TEXT_LINES ),
	};
}

/**
 * The viewport width at which WordPress's fluid font sizes stop growing when a
 * theme sets no settings.layout.wideSize, which it otherwise stops at
 * (wp_get_typography_font_size_value() in wp-includes/block-supports/typography.php).
 */
const FLUID_TYPE_MAX_WIDTH = 1600;

/**
 * The words the browser breaks across lines at FLUID_TYPE_MAX_WIDTH, where
 * fluid font sizes are at their largest, while a constrained layout's boxes
 * keep the width they have on a narrower desktop: so a word that fits on the
 * page's own viewport breaks on a wider screen. Leaves the page at its viewport.
 */
export async function pageWideTextBreaks( page: Page ): Promise< string[] > {
	const viewport = page.viewportSize();
	if ( ! viewport || viewport.width >= FLUID_TYPE_MAX_WIDTH ) {
		return [];
	}
	await page.setViewportSize( { ...viewport, width: FLUID_TYPE_MAX_WIDTH } );
	try {
		const { breaks } = await pageTextFit( page );
		return breaks.length
			? [
					`At ${ FLUID_TYPE_MAX_WIDTH }px wide, where WordPress's fluid font sizes have grown to their largest (it grows them up to the theme's settings.layout.wideSize, or ${ FLUID_TYPE_MAX_WIDTH }px when it sets none: wp_get_typography_font_size_value() in wp-includes/block-supports/typography.php) and a constrained layout's boxes keep their width:`,
					...breaks.map( ( line ) => `  ${ line }` ),
			  ]
			: [];
	} finally {
		await page.setViewportSize( viewport );
	}
}

/**
 * Text a visitor cannot read against what is behind it: a contrast ratio
 * under 3:1, which WCAG 2's 1.4.3 fails at every text size (4.5:1 for text,
 * 3:1 for large text). What is behind the text is the colors the browser
 * paints under its first line, from the text's own box down to the page; text
 * over an image, a gradient or a pseudo-element's background is not measured,
 * as no one color is behind it.
 */
export async function pageContrast( page: Page ): Promise< string[] > {
	const lines = await page.evaluate( () => {
		const generated = /^(is-|has-|wp-container-|wp-elements-|wp-block-[a-z-]+-is-layout-)/;
		const label = ( element: Element ) => {
			const tag = element.tagName.toLowerCase();
			const named =
				tag +
				[ ...element.classList ]
					.filter( ( name ) => ! generated.test( name ) )
					.slice( 0, 3 )
					.map( ( name ) => `.${ name }` )
					.join( '' );
			const text = ( element.textContent ?? '' ).replace( /\s+/g, ' ' ).trim();
			return `${ named } "${ text.length > 40 ? `${ text.slice( 0, 40 ) }…` : text }"`;
		};
		// Any CSS color, as color-mix() and oklch() compute, read as sRGB by a canvas.
		const canvas = document.createElement( 'canvas' );
		canvas.width = canvas.height = 1;
		const context = canvas.getContext( '2d', { willReadFrequently: true } );
		const rgba = ( color: string ) => {
			if ( ! context ) {
				return [ 0, 0, 0, 0 ];
			}
			context.clearRect( 0, 0, 1, 1 );
			context.fillStyle = color;
			context.fillRect( 0, 0, 1, 1 );
			const [ r, g, b, a ] = context.getImageData( 0, 0, 1, 1 ).data;
			return [ r, g, b, a / 255 ];
		};
		const over = ( top: number[], alpha: number, bottom: number[] ) =>
			bottom.map( ( channel, i ) => ( i < 3 ? top[ i ] * alpha + channel * ( 1 - alpha ) : 1 ) );
		const luminance = ( color: number[] ) => {
			const [ r, g, b ] = color.slice( 0, 3 ).map( ( channel ) => {
				const c = channel / 255;
				return c <= 0.04045 ? c / 12.92 : ( ( c + 0.055 ) / 1.055 ) ** 2.4;
			} );
			return 0.2126 * r + 0.7152 * g + 0.0722 * b;
		};
		const hex = ( color: number[] ) =>
			'#' +
			color
				.slice( 0, 3 )
				.map( ( channel ) => Math.round( channel ).toString( 16 ).padStart( 2, '0' ) )
				.join( '' );
		// Where a pseudo-element absolutely positioned in its own element paints,
		// or null where its box is not known.
		const pseudoBox = ( element: Element, style: CSSStyleDeclaration ) => {
			const sides = [ style.left, style.top, style.width, style.height ];
			if (
				style.position !== 'absolute' ||
				style.transform !== 'none' ||
				getComputedStyle( element ).position === 'static' ||
				sides.some( ( side ) => ! side.endsWith( 'px' ) )
			) {
				return null;
			}
			const [ left, top, width, height ] = sides.map( parseFloat );
			const edges = ( ...names: string[] ) =>
				style.boxSizing === 'border-box'
					? 0
					: names.reduce( ( sum, name ) => sum + parseFloat( style.getPropertyValue( name ) ), 0 );
			const owner = element.getBoundingClientRect();
			const x = owner.left + element.clientLeft + left;
			const y = owner.top + element.clientTop + top;
			return {
				left: x,
				top: y,
				right:
					x +
					width +
					edges( 'padding-left', 'padding-right', 'border-left-width', 'border-right-width' ),
				bottom:
					y +
					height +
					edges( 'padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width' ),
			};
		};
		// An image, a gradient or a pseudo-element's background painted at a point.
		const unmeasured = ( element: Element, x: number, y: number ) => {
			if ( element.matches( 'img, picture, video, canvas, svg, iframe, object, embed' ) ) {
				return true;
			}
			return [ undefined, '::before', '::after' ].some( ( pseudo ) => {
				const style = getComputedStyle( element, pseudo );
				if ( ! pseudo ) {
					return style.backgroundImage !== 'none';
				}
				if (
					style.content === 'none' ||
					( style.backgroundImage === 'none' && rgba( style.backgroundColor )[ 3 ] === 0 )
				) {
					return false;
				}
				const box = pseudoBox( element, style );
				return ! box || ( x >= box.left && x < box.right && y >= box.top && y < box.bottom );
			} );
		};
		const opacity = ( element: Element | null ) => {
			let product = 1;
			for ( let node = element; node; node = node.parentElement ) {
				product *= parseFloat( getComputedStyle( node ).opacity );
			}
			return product;
		};

		const lines: string[] = [];
		const seen = new Set< Element >();
		const scrollY = window.scrollY;
		const walker = document.createTreeWalker( document.body, NodeFilter.SHOW_TEXT );
		for ( let node = walker.nextNode(); node; node = walker.nextNode() ) {
			const element = node.parentElement;
			if ( ! element || seen.has( element ) || ! node.textContent?.trim() ) {
				continue;
			}
			seen.add( element );
			const style = getComputedStyle( element );
			if (
				style.visibility !== 'visible' ||
				style.textShadow !== 'none' ||
				element.closest( 'script, style, noscript, template, .screen-reader-text' )
			) {
				continue;
			}
			const range = document.createRange();
			range.selectNodeContents( node );
			const first = [ ...range.getClientRects() ].find(
				( rect ) => rect.width > 1 && rect.height > 1
			);
			if ( ! first ) {
				continue;
			}
			// The browser names what it paints at a point inside the viewport.
			// At once, as a theme's `scroll-behavior: smooth` would only start it.
			window.scrollTo( {
				top: window.scrollY + first.top + first.height / 2 - window.innerHeight / 2,
				behavior: 'instant',
			} );
			const rect = [ ...range.getClientRects() ].find( ( r ) => r.width > 1 && r.height > 1 );
			if ( ! rect ) {
				continue;
			}
			const x = Math.min( rect.left + Math.min( rect.width, 20 ) / 2, window.innerWidth - 1 );
			const middle = rect.top + rect.height / 2;
			const stack = document.elementsFromPoint( x, middle );
			const index = stack.indexOf( element );
			if ( index < 0 ) {
				continue;
			}
			const layers: number[][] = [];
			let backdrop: Element | undefined;
			let measured = true;
			for ( const layer of stack.slice( index ) ) {
				if ( unmeasured( layer, x, middle ) ) {
					measured = false;
					break;
				}
				const color = rgba( getComputedStyle( layer ).backgroundColor );
				const alpha = color[ 3 ] * parseFloat( getComputedStyle( layer ).opacity );
				if ( alpha > 0 ) {
					layers.push( [ ...color.slice( 0, 3 ), alpha ] );
				}
				if ( alpha >= 1 ) {
					backdrop = layer;
					break;
				}
			}
			if ( ! measured ) {
				continue;
			}
			const background = layers
				.reverse()
				.reduce( ( below, layer ) => over( layer, layer[ 3 ], below ), [ 255, 255, 255, 1 ] );
			const fill = style.getPropertyValue( '-webkit-text-fill-color' );
			const filled = rgba( fill && rgba( fill )[ 3 ] > 0 ? fill : style.color );
			// Outlined text, with no fill, shows as its stroke.
			const text =
				filled[ 3 ] === 0 && parseFloat( style.getPropertyValue( '-webkit-text-stroke-width' ) ) > 0
					? rgba( style.getPropertyValue( '-webkit-text-stroke-color' ) )
					: filled;
			const shown = over( text, text[ 3 ] * opacity( element ), background );
			const [ light, dark ] = [ luminance( shown ), luminance( background ) ].sort(
				( a, b ) => b - a
			);
			const ratio = ( light + 0.05 ) / ( dark + 0.05 );
			if ( ratio >= 3 ) {
				continue;
			}
			const y = Math.round( window.scrollY + rect.top );
			let line = `${ label( element ) }, at y ${ y }, is ${ hex( shown ) } text on ${ hex(
				background
			) }, a contrast ratio of ${ ratio.toFixed( 1 ) }:1.`;
			// A heading colored by a rule of its own does not take the color its section sets.
			const section = element.parentElement?.closest( '.has-text-color' );
			if (
				/^H[1-6]$/.test( element.tagName ) &&
				! element.classList.contains( 'has-text-color' ) &&
				! /(^|;)\s*color\s*:/.test( element.getAttribute( 'style' ) ?? '' ) &&
				section &&
				getComputedStyle( section ).color !== style.color
			) {
				line += ` Its section sets the text color ${ hex(
					rgba( getComputedStyle( section ).color )
				) }, which the heading does not take: a heading color in theme.json (styles.elements.heading, styles.elements.${ element.tagName.toLowerCase() } or styles.blocks.core/heading) is a rule on the heading itself, which wins over the color it would inherit.`;
			}
			// A block that sets a background and no text color leaves its text the color it inherits.
			if (
				backdrop?.classList.contains( 'has-background' ) &&
				! backdrop.classList.contains( 'has-text-color' ) &&
				! line.includes( 'Its section' )
			) {
				line += ` The background is ${ label( backdrop ).replace(
					/ ".*$/,
					''
				) }'s, a block with a background color (has-background) and no text color of its own (has-text-color).`;
			}
			lines.push( line );
		}
		window.scrollTo( { top: scrollY, behavior: 'instant' } );
		return lines;
	} );
	return lines.length
		? [
				'Text a visitor cannot read, under the 3:1 contrast WCAG 2 asks of large text (4.5:1 of other text; success criterion 1.4.3):',
				...boundedLines( lines, MAX_TEXT_LINES ).map( ( line ) => `  ${ line }` ),
		  ]
		: [];
}

// Each element styled to stick to the top whose parent is no taller than it:
// a sticky element moves only within its parent's box, so it scrolls away
// with that parent. WordPress wraps each template part in an element of its
// own (render_block_core_template_part()), as tall as the part's group.
export function pageSticky( page: Page ): Promise< string[] > {
	return page.evaluate( () => {
		const generated = /^(is-|has-|wp-container-|wp-elements-|wp-block-[a-z-]+-is-layout-)/;
		const label = ( element: Element ) =>
			element.tagName.toLowerCase() +
			[ ...element.classList ]
				.filter( ( name ) => ! generated.test( name ) )
				.slice( 0, 3 )
				.map( ( name ) => `.${ name }` )
				.join( '' );
		const lines: string[] = [];
		for ( const element of document.querySelectorAll( 'body *' ) ) {
			const style = getComputedStyle( element );
			const parent = element.parentElement;
			if ( style.position !== 'sticky' || style.top === 'auto' || ! parent ) {
				continue;
			}
			const box = parent.getBoundingClientRect();
			const parentStyle = getComputedStyle( parent );
			const room =
				box.height -
				parseFloat( parentStyle.paddingTop ) -
				parseFloat( parentStyle.paddingBottom ) -
				parseFloat( parentStyle.borderTopWidth ) -
				parseFloat( parentStyle.borderBottomWidth ) -
				element.getBoundingClientRect().height -
				parseFloat( style.marginTop ) -
				parseFloat( style.marginBottom );
			if ( ! box.height || room >= 1 ) {
				continue;
			}
			lines.push(
				`\`${ label( element ) }\` is position: sticky inside \`${ label(
					parent
				) }\`, a wrapper exactly its height, so it scrolls away with that wrapper: a sticky element sticks within its parent's box.${
					parent.classList.contains( 'wp-block-template-part' )
						? ' WordPress wraps each template part in that element, so the wrapper is the one to make sticky.'
						: ''
				}`
			);
		}
		return lines;
	} );
}

/**
 * Each paragraph or list item of more than 30 characters whose text renders
 * more than 2.25 times the page's body text size (16px when it has none), as
 * a visitor reads text that large as a heading: the visible P and LI not
 * inside other text, as the eval's grader picks them (apps/cli/ai/eval-outcome.ts).
 */
export async function pageLargeText( page: Page, bodyFontSize = 16 ): Promise< string[] > {
	const lines = await page.evaluate( ( bodySize ) => {
		const lines: string[] = [];
		for ( const element of document.querySelectorAll( 'p, li' ) ) {
			const box = element.getBoundingClientRect();
			const style = getComputedStyle( element );
			const text = ( element.textContent ?? '' ).trim();
			const fontSize = parseFloat( style.fontSize );
			if (
				! box.width ||
				! box.height ||
				style.visibility === 'hidden' ||
				element.parentElement?.closest( 'p, h1, h2, h3, h4, h5, h6, li' ) ||
				style.clipPath !== 'none' ||
				style.clip !== 'auto' ||
				text.length <= 30 ||
				fontSize <= bodySize * 2.25
			) {
				continue;
			}
			const shown = text.replace( /\s+/g, ' ' );
			const px = ( size: number ) => `${ Math.round( size * 10 ) / 10 }px`;
			lines.push(
				`${ element.tagName.toLowerCase() } "${
					shown.length > 40 ? `${ shown.slice( 0, 40 ) }…` : shown
				}" is ${ px( fontSize ) }, ${
					Math.round( ( fontSize / bodySize ) * 10 ) / 10
				} times the ${ px( bodySize ) } body text; text this large reads as a heading.`
			);
		}
		return [ ...new Set( lines ) ];
	}, bodyFontSize );
	return boundedLines( lines, MAX_TEXT_LINES );
}

/**
 * What a visitor gets that is broken, as the browser loaded the page: PHP's
 * own error output, which PHP prints into the page when display_errors is on
 * (php_error_cb() in main/main.c, as WordPress turns it on with WP_DEBUG in
 * wp_debug_mode()), WordPress's critical error screen (wp_die() from
 * WP_Fatal_Error_Handler::display_default_error_template()), and images the
 * browser could not load.
 */
export function pageBreakage( page: Page ): Promise< string[] > {
	return page.evaluate( () => {
		const lines: string[] = [];
		const text = document.body?.innerText ?? '';
		for ( const match of text.matchAll(
			/\b(Fatal error|Parse error|Warning|Notice|Deprecated): (.{0,200}?) in (\S+) on line (\d+)/g
		) ) {
			lines.push(
				`PHP printed "${ match[ 1 ] }: ${ match[ 2 ] }" (${ match[ 3 ] }:${ match[ 4 ] }).`
			);
		}
		if ( text.includes( 'There has been a critical error on this website.' ) ) {
			lines.push( 'WordPress shows its critical error screen in place of the page.' );
		}
		for ( const image of document.images ) {
			if ( image.complete && image.naturalWidth === 0 && image.currentSrc ) {
				lines.push( `The image ${ image.currentSrc } did not load.` );
			}
		}
		return [ ...new Set( lines ) ];
	} );
}
