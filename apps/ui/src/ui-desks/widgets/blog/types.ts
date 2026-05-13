import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const BLOG_WIDGET_TYPE = 'blog';

export type BlogWidgetProps = {
	title: string;
	slug?: string;
};

export type BlogWidget = DeskWidgetBase<
	typeof BLOG_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	BlogWidgetProps
>;

export function isBlogWidgetProps( value: unknown ): value is BlogWidgetProps {
	const candidate = value as Partial< BlogWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof candidate.title === 'string' &&
		( candidate.slug === undefined || typeof candidate.slug === 'string' )
	);
}
