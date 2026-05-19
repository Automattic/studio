import type { SiteCardWidget } from './types';
import type { WidgetFitContentContext, WidgetFitContentResult } from '@/ui-desks/widgets/types';

export const SITE_CARD_BODY_HEIGHT = 200;
export const SITE_CARD_PREVIEW_HEIGHT = 240;
export const SITE_CARD_WITH_PREVIEW_HEIGHT = SITE_CARD_BODY_HEIGHT + SITE_CARD_PREVIEW_HEIGHT;

export function getFittedSiteCardShapeProps( {
	widgetProps,
	shapeProps,
}: WidgetFitContentContext< SiteCardWidget > ): WidgetFitContentResult< SiteCardWidget > {
	if ( widgetProps.previewVisible ) {
		return {
			...shapeProps,
			h: Math.max( shapeProps.h, SITE_CARD_WITH_PREVIEW_HEIGHT ),
		};
	}

	return {
		...shapeProps,
		h: shapeProps.h <= SITE_CARD_WITH_PREVIEW_HEIGHT + 4 ? SITE_CARD_BODY_HEIGHT : shapeProps.h,
	};
}
