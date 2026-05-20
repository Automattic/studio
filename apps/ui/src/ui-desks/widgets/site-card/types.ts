import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const SITE_CARD_WIDGET_TYPE = 'site-card';

export type SiteCardWidgetProps = {
	siteId?: string;
	previewVisible: boolean;
};

export type SiteCardWidget = DeskWidgetBase<
	typeof SITE_CARD_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	SiteCardWidgetProps
>;

export function isSiteCardWidgetProps( value: unknown ): value is SiteCardWidgetProps {
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof ( value as Partial< SiteCardWidgetProps > ).previewVisible === 'boolean' &&
		( ( value as Partial< SiteCardWidgetProps > ).siteId === undefined ||
			typeof ( value as Partial< SiteCardWidgetProps > ).siteId === 'string' )
	);
}
