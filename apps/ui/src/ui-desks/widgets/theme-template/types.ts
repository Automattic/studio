import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const THEME_TEMPLATE_WIDGET_TYPE = 'theme-template';

export type ThemeTemplateSource = 'theme' | 'custom' | 'plugin';

export type ThemeTemplateWidgetProps = {
	templateId: string;
	slug: string;
	title: string;
	description: string;
	source: ThemeTemplateSource;
};

export type ThemeTemplateWidget = DeskWidgetBase<
	typeof THEME_TEMPLATE_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	ThemeTemplateWidgetProps
>;

export function isThemeTemplateWidgetProps( value: unknown ): value is ThemeTemplateWidgetProps {
	const candidate = value as Partial< ThemeTemplateWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof candidate.templateId === 'string' &&
		typeof candidate.slug === 'string' &&
		typeof candidate.title === 'string' &&
		typeof candidate.description === 'string' &&
		isThemeTemplateSource( candidate.source )
	);
}

function isThemeTemplateSource( value: unknown ): value is ThemeTemplateSource {
	return value === 'theme' || value === 'custom' || value === 'plugin';
}
