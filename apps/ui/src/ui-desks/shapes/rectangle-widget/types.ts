import {
	isRectangleWidgetShapeProps,
	type RectangleWidgetShapeProps,
} from '@/ui-desks/widget-actions/geometry';
import type { JsonObject, TLBaseShape } from 'tldraw';

export { isRectangleWidgetShapeProps, type RectangleWidgetShapeProps };

export const RECTANGLE_WIDGET_SHAPE_TYPE = 'studio-rectangle-widget';

export type RectangleWidgetCanvasProps = {
	widgetType: string;
	shapeProps: RectangleWidgetShapeProps;
	widgetProps: JsonObject;
};

export type RectangleWidgetShape = TLBaseShape<
	typeof RECTANGLE_WIDGET_SHAPE_TYPE,
	RectangleWidgetCanvasProps
>;
