import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const THEME_PATTERN_WIDGET_TYPE = 'theme-pattern';

export type ThemePatternSource = 'theme' | 'reusable' | 'template-part';

export type ThemePatternWidgetProps = {
	patternId: string;
	title: string;
	content: string;
	source: ThemePatternSource;
	blockId?: number;
	area?: string;
};

export type ThemePatternWidget = DeskWidgetBase<
	typeof THEME_PATTERN_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	ThemePatternWidgetProps
>;

export function isThemePatternWidgetProps( value: unknown ): value is ThemePatternWidgetProps {
	const candidate = value as Partial< ThemePatternWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof candidate.patternId === 'string' &&
		typeof candidate.title === 'string' &&
		typeof candidate.content === 'string' &&
		isThemePatternSource( candidate.source ) &&
		( candidate.blockId === undefined || typeof candidate.blockId === 'number' ) &&
		( candidate.area === undefined || typeof candidate.area === 'string' )
	);
}

function isThemePatternSource( value: unknown ): value is ThemePatternSource {
	return value === 'theme' || value === 'reusable' || value === 'template-part';
}
