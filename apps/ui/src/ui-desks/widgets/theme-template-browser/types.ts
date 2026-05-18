import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const THEME_TEMPLATE_BROWSER_WIDGET_TYPE = 'theme-template-browser';

export type ThemeTemplateBrowserWidgetProps = Record< string, never >;

export type ThemeTemplateBrowserWidget = DeskWidgetBase<
	typeof THEME_TEMPLATE_BROWSER_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	ThemeTemplateBrowserWidgetProps
>;

export function isThemeTemplateBrowserWidgetProps(
	value: unknown
): value is ThemeTemplateBrowserWidgetProps {
	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );
}
