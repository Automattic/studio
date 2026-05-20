import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const SITE_SHORTCUTS_WIDGET_TYPE = 'site-shortcuts';

export type SiteShortcutsWidgetProps = {
	siteId?: string;
};

export type SiteShortcutsWidget = DeskWidgetBase<
	typeof SITE_SHORTCUTS_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	SiteShortcutsWidgetProps
>;

export function isSiteShortcutsWidgetProps( value: unknown ): value is SiteShortcutsWidgetProps {
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		( ( value as Partial< SiteShortcutsWidgetProps > ).siteId === undefined ||
			typeof ( value as Partial< SiteShortcutsWidgetProps > ).siteId === 'string' )
	);
}
