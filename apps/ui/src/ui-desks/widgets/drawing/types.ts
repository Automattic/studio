import type { RectangleWidgetShapeProps } from '@/ui-desks/widgets/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const DRAWING_WIDGET_TYPE = 'drawing';

export type DrawingWidgetProps = {
	svg: string;
};

export type DrawingWidget = DeskWidgetBase<
	typeof DRAWING_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	DrawingWidgetProps
>;

export function isDrawingWidgetProps( props: unknown ): props is DrawingWidgetProps {
	return (
		Boolean( props ) &&
		typeof props === 'object' &&
		typeof ( props as Partial< DrawingWidgetProps > ).svg === 'string'
	);
}
