import { createShapeId, type TLCamera, type TLShape, type TLShapePartial } from 'tldraw';
import {
	NOTE_WIDGET_CANVAS_TYPE,
	NOTE_WIDGET_TYPE,
	type NoteWidget,
	type NoteColor,
} from '@/ui-desks/widgets/note/types';
import type { DeskViewport } from '@/ui-desks/desk/types';
import type { DeskWidget } from '@/ui-desks/widgets/types';

const SHAPE_ID_PREFIX = 'shape:';
const CANVAS_TYPE_PREFIX = 'studio-';

export function deskWidgetToCanvasShape( widget: DeskWidget ): TLShapePartial {
	return {
		id: createShapeId( widget.id ),
		type: `${ CANVAS_TYPE_PREFIX }${ widget.type }`,
		x: widget.x,
		y: widget.y,
		rotation: widget.rotation ?? 0,
		index: widget.zIndex as TLShapePartial[ 'index' ],
		props: widget.props,
	};
}

export function canvasShapeToDeskWidget( shape: TLShape ): DeskWidget | null {
	if ( shape.type !== NOTE_WIDGET_CANVAS_TYPE || ! isNoteWidgetProps( shape.props ) ) {
		return null;
	}

	const widget: NoteWidget = {
		id: shape.id.startsWith( SHAPE_ID_PREFIX )
			? shape.id.slice( SHAPE_ID_PREFIX.length )
			: shape.id,
		type: NOTE_WIDGET_TYPE,
		x: shape.x,
		y: shape.y,
		rotation: shape.rotation || undefined,
		zIndex: shape.index,
		props: shape.props,
	};
	return widget;
}

export function canvasCameraToDeskViewport(
	camera: Pick< TLCamera, 'x' | 'y' | 'z' >
): DeskViewport {
	return {
		x: camera.x,
		y: camera.y,
		z: camera.z,
	};
}

function isNoteColor( value: unknown ): value is NoteColor {
	return value === 'yellow' || value === 'blue' || value === 'green' || value === 'pink';
}

function isNoteWidgetProps( props: TLShape[ 'props' ] ): props is NoteWidget[ 'props' ] {
	const candidate = props as Partial< NoteWidget[ 'props' ] >;
	return (
		typeof candidate.w === 'number' &&
		typeof candidate.h === 'number' &&
		typeof candidate.text === 'string' &&
		isNoteColor( candidate.color )
	);
}
