import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { ThemePaletteEntry } from '@/ui-desks/widgets/theme/api';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const THEME_STYLES_WIDGET_TYPE = 'theme-styles';

export type ThemeStylesWidgetProps = {
	palette: ThemePaletteEntry[];
	fontFamily: string;
	textColor: string;
	backgroundColor: string;
};

export type ThemeStylesWidget = DeskWidgetBase<
	typeof THEME_STYLES_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	ThemeStylesWidgetProps
>;

export function isThemeStylesWidgetProps( value: unknown ): value is ThemeStylesWidgetProps {
	const candidate = value as Partial< ThemeStylesWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		Array.isArray( candidate.palette ) &&
		candidate.palette.every( isThemePaletteEntry ) &&
		typeof candidate.fontFamily === 'string' &&
		typeof candidate.textColor === 'string' &&
		typeof candidate.backgroundColor === 'string'
	);
}

function isThemePaletteEntry( value: unknown ): value is ThemePaletteEntry {
	const candidate = value as Partial< ThemePaletteEntry >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof candidate.slug === 'string' &&
		( candidate.name === undefined || typeof candidate.name === 'string' ) &&
		typeof candidate.color === 'string'
	);
}
