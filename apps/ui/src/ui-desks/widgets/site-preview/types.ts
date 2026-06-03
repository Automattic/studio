import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const SITE_PREVIEW_WIDGET_TYPE = 'site-preview';

export type SitePreviewWidgetProps = {
	path: string;
};

export type SitePreviewWidget = DeskWidgetBase<
	typeof SITE_PREVIEW_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	SitePreviewWidgetProps
>;

export function isSitePreviewWidgetProps( value: unknown ): value is SitePreviewWidgetProps {
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof ( value as Partial< SitePreviewWidgetProps > ).path === 'string'
	);
}
