import { getUrlEmbedInfo } from '../embed-info';
import type { EmbedWidgetProps } from '../types';
import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';

export function getFittedEmbedShapeProps(
	widgetProps: EmbedWidgetProps,
	shapeProps: RectangleWidgetShapeProps
): RectangleWidgetShapeProps | null {
	const embedInfo = getUrlEmbedInfo( widgetProps.url );
	if (
		! embedInfo ||
		embedInfo.definition.width <= 0 ||
		embedInfo.definition.height <= 0 ||
		shapeProps.w <= 0
	) {
		return null;
	}

	return {
		...shapeProps,
		h: Math.max(
			1,
			Math.round( ( shapeProps.w * embedInfo.definition.height ) / embedInfo.definition.width )
		),
	};
}
