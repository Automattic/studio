import { normalizeHttpUrl } from '@/ui-desks/widgets/url';
import type { RectangleWidgetShapeProps } from '@/ui-desks/widgets/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const EMBED_WIDGET_TYPE = 'embed';

export type EmbedWidgetProps = {
	url: string;
};

export type EmbedWidget = DeskWidgetBase<
	typeof EMBED_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	EmbedWidgetProps
>;

export function isEmbedWidgetProps( value: unknown ): value is EmbedWidgetProps {
	const candidate = value as Partial< EmbedWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof candidate.url === 'string' &&
		( candidate.url === '' || normalizeHttpUrl( candidate.url ) !== null )
	);
}
