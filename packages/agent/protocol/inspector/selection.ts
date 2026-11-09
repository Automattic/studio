import type { VisualAnnotationTarget } from '@studio/agent/protocol/visual-annotations';

interface AnnotationRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface InspectorSelection {
	id: string;
	target: VisualAnnotationTarget & {
		kind: 'region';
		url: string;
		viewport: { width: number; height: number };
		documentRect: AnnotationRect;
	};
	rect: AnnotationRect;
	scroll: { left: number; top: number };
}

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
		target.kind !== 'region' ||
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
		! [ area.left, area.top, area.width, area.height ].every( Number.isInteger ) ||
		area.left < 0 ||
		area.top < 0 ||
		area.left + area.width > width ||
		area.top + area.height > height ||
		Math.abs( documentRect.left - area.left - left ) > 1 ||
		Math.abs( documentRect.top - area.top - top ) > 1 ||
		documentRect.width !== area.width ||
		documentRect.height !== area.height
	)
		return null;
	return {
		id: value.id,
		target: {
			kind: 'region',
			url: target.url,
			path: typeof target.path === 'string' ? target.path.slice( 0, 10_000 ) : undefined,
			viewport: { width, height },
			documentRect,
			point: { x: 1, y: 0 },
		},
		rect: area,
		scroll: { left, top },
	};
}
