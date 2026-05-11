import type { RectangleWidgetShapeProps } from '@/ui-desks/widgets/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const LOADING_WIDGET_TYPE = 'loading';

export type LoadingWidgetProps = {
	label: string;
};

export type LoadingWidget = DeskWidgetBase<
	typeof LOADING_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	LoadingWidgetProps
>;

export function isLoadingWidgetProps( value: unknown ): value is LoadingWidgetProps {
	const candidate = value as Partial< LoadingWidgetProps >;
	return Boolean( value ) && typeof value === 'object' && typeof candidate.label === 'string';
}
