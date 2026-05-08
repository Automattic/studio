import type { JsonObject, TLBaseShape } from 'tldraw';

export const RECTANGLE_WIDGET_SHAPE_TYPE = 'studio-rectangle-widget';

export type RectangleWidgetShapeProps = {
	w: number;
	h: number;
};

export type RectangleWidgetCanvasProps = {
	widgetType: string;
	shapeProps: RectangleWidgetShapeProps;
	widgetProps: JsonObject;
};

export type RectangleWidgetShape = TLBaseShape<
	typeof RECTANGLE_WIDGET_SHAPE_TYPE,
	RectangleWidgetCanvasProps
>;

export function isRectangleWidgetShapeProps( value: unknown ): value is RectangleWidgetShapeProps {
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof ( value as Partial< RectangleWidgetShapeProps > ).w === 'number' &&
		typeof ( value as Partial< RectangleWidgetShapeProps > ).h === 'number'
	);
}
