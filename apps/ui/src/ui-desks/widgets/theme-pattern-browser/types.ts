import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskStackViewMode, DeskWidgetBase } from '@studio/common/types/desk';

export const THEME_PATTERN_BROWSER_WIDGET_TYPE = 'theme-pattern-browser';

export type ThemePatternBrowserWidgetProps = {
	limit: number;
	viewMode?: DeskStackViewMode;
};

export type ThemePatternBrowserWidget = DeskWidgetBase<
	typeof THEME_PATTERN_BROWSER_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	ThemePatternBrowserWidgetProps
>;

export function isThemePatternBrowserWidgetProps(
	value: unknown
): value is ThemePatternBrowserWidgetProps {
	const candidate = value as Partial< ThemePatternBrowserWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		! Array.isArray( value ) &&
		typeof candidate.limit === 'number' &&
		Number.isInteger( candidate.limit ) &&
		candidate.limit >= 1 &&
		candidate.limit <= 50 &&
		isThemePatternBrowserViewMode( candidate.viewMode )
	);
}

function isThemePatternBrowserViewMode( value: unknown ): value is DeskStackViewMode | undefined {
	return value === undefined || value === 'stack' || value === 'tiles' || value === 'circle';
}
