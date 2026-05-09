import { createShapeId, type TLCamera, type TLShape, type TLShapePartial } from 'tldraw';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetCanvasProps,
} from '@/ui-desks/shapes/rectangle-widget/types';
import { isRectangleWidgetShapeProps } from '@/ui-desks/widgets/geometry';
import { getWidgetDefinition } from '@/ui-desks/widgets/registry';
import type { DeskViewport } from '@/ui-desks/desk/types';
import type { DeskWidget } from '@/ui-desks/widgets/types';

const SHAPE_ID_PREFIX = 'shape:';

export function deskWidgetToCanvasShape( widget: DeskWidget ): TLShapePartial {
	const definition = getWidgetDefinition( widget.type );
	if ( ! definition ) {
		throw new Error( `Unknown desk widget type: ${ widget.type }.` );
	}

	return {
		id: createShapeId( widget.id ),
		type: RECTANGLE_WIDGET_SHAPE_TYPE,
		x: widget.x,
		y: widget.y,
		rotation: widget.rotation ?? 0,
		index: widget.zIndex as TLShapePartial[ 'index' ],
		props: {
			widgetType: widget.type,
			shapeProps: widget.shapeProps,
			widgetProps: widget.widgetProps,
		},
	};
}

export function canvasShapeToDeskWidget( shape: TLShape ): DeskWidget | null {
	if (
		shape.type !== RECTANGLE_WIDGET_SHAPE_TYPE ||
		! isRectangleWidgetCanvasProps( shape.props )
	) {
		return null;
	}

	const definition = getWidgetDefinition( shape.props.widgetType );
	if ( ! definition || ! definition.isWidgetProps( shape.props.widgetProps ) ) {
		return null;
	}

	return {
		id: shape.id.startsWith( SHAPE_ID_PREFIX )
			? shape.id.slice( SHAPE_ID_PREFIX.length )
			: shape.id,
		type: shape.props.widgetType,
		x: shape.x,
		y: shape.y,
		rotation: shape.rotation || undefined,
		zIndex: shape.index,
		shapeProps: shape.props.shapeProps,
		widgetProps: shape.props.widgetProps,
	} as unknown as DeskWidget;
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

function isRectangleWidgetCanvasProps(
	props: TLShape[ 'props' ]
): props is RectangleWidgetCanvasProps {
	const candidate = props as Partial< RectangleWidgetCanvasProps >;
	return (
		typeof candidate.widgetType === 'string' &&
		isRectangleWidgetShapeProps( candidate.shapeProps ) &&
		Boolean( candidate.widgetProps ) &&
		typeof candidate.widgetProps === 'object'
	);
}
