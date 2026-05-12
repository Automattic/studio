import { normalizeHttpUrl } from '@/ui-desks/widgets/url';
import type { RectangleWidgetShapeProps } from '@/ui-desks/widgets/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const BOOKMARK_WIDGET_TYPE = 'bookmark';

export type BookmarkWidgetProps = {
	url: string;
};

export type BookmarkWidget = DeskWidgetBase<
	typeof BOOKMARK_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	BookmarkWidgetProps
>;

export function isBookmarkWidgetProps( value: unknown ): value is BookmarkWidgetProps {
	const candidate = value as Partial< BookmarkWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof candidate.url === 'string' &&
		( candidate.url === '' || normalizeHttpUrl( candidate.url ) !== null )
	);
}
