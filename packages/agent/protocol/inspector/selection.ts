import type { VisualAnnotationTarget } from '@studio/agent/protocol/visual-annotations';

export interface AnnotationRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface AnnotationDrawing {
	strokes: { x: number; y: number }[][];
	color: string;
	width: number;
}

export interface InspectorSelection {
	id: string;
	target: VisualAnnotationTarget & {
		kind: 'region' | 'drawing';
		url: string;
		viewport: { width: number; height: number };
		documentRect: AnnotationRect;
	};
	rect: AnnotationRect;
	scroll: { left: number; top: number };
	drawing?: AnnotationDrawing;
}

export const MAX_DRAWING_POINTS = 2048;
export const MAX_DRAWING_STROKES = 128;
export const ANNOTATION_PEN_WIDTH = 3;

const record = ( value: unknown ): value is Record< string, unknown > =>
	typeof value === 'object' && value !== null;
const coordinate = ( value: unknown ): value is number =>
	typeof value === 'number' && Number.isFinite( value ) && Math.abs( value ) <= 10_000_000;

function rect( value: unknown ): AnnotationRect | null {
	if (
		! record( value ) ||
		! coordinate( value.left ) ||
		! coordinate( value.top ) ||
		! coordinate( value.width ) ||
		! coordinate( value.height ) ||
		value.width <= 0 ||
		value.height <= 0
	)
		return null;
	return { left: value.left, top: value.top, width: value.width, height: value.height };
}

export function parseInspectorSelection( value: unknown ): InspectorSelection | null {
	if ( ! record( value ) || typeof value.id !== 'string' || ! value.id || value.id.length > 100 )
		return null;
	const target = value.target;
	if (
		! record( target ) ||
		( target.kind !== 'region' && target.kind !== 'drawing' ) ||
		typeof target.url !== 'string' ||
		target.url.length > 10_000 ||
		! record( target.viewport ) ||
		! record( value.scroll )
	)
		return null;
	const { width, height } = target.viewport;
	const { left, top } = value.scroll;
	const area = rect( value.rect );
	const documentRect = rect( target.documentRect );
	if (
		! area ||
		! documentRect ||
		! coordinate( width ) ||
		! coordinate( height ) ||
		width <= 0 ||
		height <= 0 ||
		width > 32768 ||
		height > 32768 ||
		! coordinate( left ) ||
		! coordinate( top ) ||
		area.left < 0 ||
		area.top < 0 ||
		area.left + area.width > width + 1 ||
		area.top + area.height > height + 1 ||
		Math.abs( documentRect.left - area.left - left ) > 1 ||
		Math.abs( documentRect.top - area.top - top ) > 1 ||
		documentRect.width !== area.width ||
		documentRect.height !== area.height
	)
		return null;
	let drawing: AnnotationDrawing | undefined;
	if ( target.kind === 'drawing' ) {
		const input = value.drawing;
		if (
			! record( input ) ||
			! Array.isArray( input.strokes ) ||
			! input.strokes.length ||
			input.strokes.length > MAX_DRAWING_STROKES ||
			typeof input.color !== 'string' ||
			! input.color ||
			input.color.length > 128 ||
			input.width !== ANNOTATION_PEN_WIDTH
		)
			return null;
		let count = 0;
		const strokes: AnnotationDrawing[ 'strokes' ] = [];
		for ( const stroke of input.strokes ) {
			if ( ! Array.isArray( stroke ) || ! stroke.length ) return null;
			count += stroke.length;
			if ( count > MAX_DRAWING_POINTS ) return null;
			const points: AnnotationDrawing[ 'strokes' ][ number ] = [];
			for ( const point of stroke ) {
				if (
					! record( point ) ||
					! coordinate( point.x ) ||
					! coordinate( point.y ) ||
					point.x < left ||
					point.x > left + width ||
					point.y < top ||
					point.y > top + height
				)
					return null;
				points.push( { x: point.x, y: point.y } );
			}
			strokes.push( points );
		}
		drawing = { strokes, color: input.color, width: input.width };
	}
	return {
		id: value.id,
		target: {
			kind: target.kind,
			url: target.url,
			path: typeof target.path === 'string' ? target.path.slice( 0, 10_000 ) : undefined,
			viewport: { width, height },
			documentRect,
			point: { x: 1, y: 0 },
		},
		rect: area,
		scroll: { left, top },
		...( drawing ? { drawing } : {} ),
	};
}
