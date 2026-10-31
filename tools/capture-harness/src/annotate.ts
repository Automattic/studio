/**
 * Annotations are drawn into the document as a fixed overlay built from
 * element bounding boxes, so they follow the real UI. Each returns the extent
 * it drew, which a cropped capture adds to its clip so marks are never cut off.
 *
 *   { "outline": LOC }
 *   { "badge": LOC }                       numbered in order, at the top-left corner
 *   { "arrow": LOC, "from"?: "top-right" }
 */
import { boundingBoxOf, verbOf, type Box } from './locators.ts';
import { ANNOTATION_TYPES, type Annotation } from './schema.ts';
import type { Ctx } from './context.ts';

const OVERLAY_ID = 'studio-capture-annotations';

// The marks' sizes; their colors come from the look (`annotations`).
const SIZES = {
	outline: { width: 3, radius: 6, gap: 4 },
	badge: {
		size: 26,
		font: '600 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
	},
	arrow: { width: 3, length: 48, head: 14, gap: 6 },
};

interface Item {
	type: ( typeof ANNOTATION_TYPES )[ number ];
	box: Box;
	label?: string;
	from?: string;
}

/** Draws `annotations`; returns the drawn extents and a function that removes the overlay. */
export async function drawAnnotations( ctx: Ctx, annotations: Annotation[] ) {
	const items: Item[] = [];
	let badges = 0;
	for ( const annotation of annotations ) {
		const type = verbOf( annotation, ANNOTATION_TYPES, 'annotation' );
		const item: Item = {
			type,
			box: await boundingBoxOf( ctx, ( annotation as Record< typeof type, never > )[ type ] ),
		};
		if ( type === 'badge' ) {
			item.label = String( ++badges );
		} else if ( type === 'arrow' ) {
			item.from = ( 'from' in annotation && annotation.from ) || 'top-right';
		}
		items.push( item );
	}
	const style = { ...SIZES, ...ctx.look.annotations };

	const extents = await ctx.w.evaluate(
		( { id, items: list, s } ) => {
			document.getElementById( id )?.remove();
			const layer = document.createElement( 'div' );
			layer.id = id;
			Object.assign( layer.style, {
				position: 'fixed',
				inset: '0',
				pointerEvents: 'none',
				zIndex: '2147483647',
			} );
			const out: Box[] = [];
			const halo = 2;
			const place = ( el: HTMLElement | SVGElement, x: number, y: number, w: number, h: number ) =>
				Object.assign( el.style, {
					position: 'absolute',
					left: `${ x }px`,
					top: `${ y }px`,
					width: `${ w }px`,
					height: `${ h }px`,
				} );

			for ( const item of list ) {
				const { box } = item;
				if ( item.type === 'outline' ) {
					const inset = s.outline.gap + s.outline.width;
					const el = document.createElement( 'div' );
					place( el, box.x - inset, box.y - inset, box.width + inset * 2, box.height + inset * 2 );
					Object.assign( el.style, {
						border: `${ s.outline.width }px solid ${ s.accent }`,
						borderRadius: `${ s.outline.radius + s.outline.gap }px`,
						boxSizing: 'border-box',
						outline: `${ halo }px solid ${ s.halo }`,
						boxShadow: `inset 0 0 0 ${ halo }px ${ s.halo }`,
					} );
					layer.appendChild( el );
					const reach = inset + halo;
					out.push( {
						x: box.x - reach,
						y: box.y - reach,
						width: box.width + reach * 2,
						height: box.height + reach * 2,
					} );
				} else if ( item.type === 'badge' ) {
					const half = s.badge.size / 2;
					// Top-left of the element, or the opposite corner where that leaves the window.
					const x = box.x - half - halo < 0 ? box.x + box.width - half : box.x - half;
					const y = box.y - half - halo < 0 ? box.y + box.height - half : box.y - half;
					const el = document.createElement( 'div' );
					place( el, x, y, s.badge.size, s.badge.size );
					Object.assign( el.style, {
						borderRadius: '50%',
						background: s.accent,
						color: s.halo,
						font: s.badge.font,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
						outline: `${ halo }px solid ${ s.halo }`,
					} );
					el.textContent = item.label ?? '';
					layer.appendChild( el );
					out.push( {
						x: x - halo,
						y: y - halo,
						width: s.badge.size + halo * 2,
						height: s.badge.size + halo * 2,
					} );
				} else if ( item.type === 'arrow' ) {
					const a = s.arrow;
					const dirs: Record< string, [ number, number ] > = {
						top: [ 0, 1 ],
						bottom: [ 0, -1 ],
						left: [ 1, 0 ],
						right: [ -1, 0 ],
						'top-left': [ 1, 1 ],
						'top-right': [ -1, 1 ],
						'bottom-left': [ 1, -1 ],
						'bottom-right': [ -1, -1 ],
					};
					const [ ux, uy ] = dirs[ item.from ?? 'top-right' ];
					const norm = Math.hypot( ux, uy );
					const dx = ux / norm;
					const dy = uy / norm;
					// Aim at the edge midpoint for cardinal directions, the corner for diagonals.
					const ax = dx > 0 ? box.x : dx < 0 ? box.x + box.width : box.x + box.width / 2;
					const ay = dy > 0 ? box.y : dy < 0 ? box.y + box.height : box.y + box.height / 2;
					const tipX = ax - dx * a.gap;
					const tipY = ay - dy * a.gap;
					const tailX = tipX - dx * a.length;
					const tailY = tipY - dy * a.length;
					const shaftX = tipX - dx * a.head;
					const shaftY = tipY - dy * a.head;
					const px = -dy;
					const py = dx;
					const wing = a.head * 0.55;
					const head = [
						[ tipX, tipY ],
						[ shaftX + px * wing, shaftY + py * wing ],
						[ shaftX - px * wing, shaftY - py * wing ],
					]
						.map( ( pt ) => pt.map( ( n ) => n.toFixed( 2 ) ).join( ',' ) )
						.join( ' ' );
					const ns = 'http://www.w3.org/2000/svg';
					const svg = document.createElementNS( ns, 'svg' );
					Object.assign( svg.style, {
						position: 'absolute',
						inset: '0',
						width: '100%',
						height: '100%',
						overflow: 'visible',
					} );
					const draw = ( color: string, extra: number ) => {
						const line = document.createElementNS( ns, 'line' );
						line.setAttribute( 'x1', tailX.toFixed( 2 ) );
						line.setAttribute( 'y1', tailY.toFixed( 2 ) );
						line.setAttribute( 'x2', shaftX.toFixed( 2 ) );
						line.setAttribute( 'y2', shaftY.toFixed( 2 ) );
						line.setAttribute( 'stroke', color );
						line.setAttribute( 'stroke-width', String( a.width + extra * 2 ) );
						line.setAttribute( 'stroke-linecap', 'round' );
						svg.appendChild( line );
						const poly = document.createElementNS( ns, 'polygon' );
						poly.setAttribute( 'points', head );
						poly.setAttribute( 'fill', color );
						poly.setAttribute( 'stroke', color );
						poly.setAttribute( 'stroke-width', String( extra * 2 ) );
						poly.setAttribute( 'stroke-linejoin', 'round' );
						svg.appendChild( poly );
					};
					draw( s.halo, halo );
					draw( s.accent, 0 );
					layer.appendChild( svg );
					const xs = [ tailX, tipX, shaftX + px * wing, shaftX - px * wing ];
					const ys = [ tailY, tipY, shaftY + py * wing, shaftY - py * wing ];
					const reach = a.width + halo;
					out.push( {
						x: Math.min( ...xs ) - reach,
						y: Math.min( ...ys ) - reach,
						width: Math.max( ...xs ) - Math.min( ...xs ) + reach * 2,
						height: Math.max( ...ys ) - Math.min( ...ys ) + reach * 2,
					} );
					out.push( box );
				}
			}
			document.body.appendChild( layer );
			return out;
		},
		{ id: OVERLAY_ID, items, s: style }
	);

	return {
		extents,
		remove: () =>
			ctx.w
				.evaluate( ( id ) => document.getElementById( id )?.remove(), OVERLAY_ID )
				.catch( () => {} ),
	};
}
