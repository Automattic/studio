import type { RectangleWidgetShapeProps } from '@/ui-desks/widgets/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const POST_WIDGET_TYPE = 'post';

export type PostWidgetProps = {
	postId: number;
};

export type PostWidget = DeskWidgetBase<
	typeof POST_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	PostWidgetProps
>;

export function isPostWidgetProps( value: unknown ): value is PostWidgetProps {
	const candidate = value as Partial< PostWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof candidate.postId === 'number' &&
		Number.isInteger( candidate.postId ) &&
		candidate.postId >= 0
	);
}
