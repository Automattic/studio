import type { RectangleWidgetShapeProps } from '@/ui-desks/widgets/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const MEDIA_WIDGET_TYPE = 'media';

export const MEDIA_KINDS = [ 'image', 'video' ] as const;

export type MediaKind = ( typeof MEDIA_KINDS )[ number ];

export type MediaWidgetProps = {
	url: string;
	mediaKind: MediaKind;
	alt: string;
	mediaId: number | null;
};

export type MediaWidget = DeskWidgetBase<
	typeof MEDIA_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	MediaWidgetProps
>;

export function isMediaWidgetProps( value: unknown ): value is MediaWidgetProps {
	const candidate = value as Partial< MediaWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof candidate.url === 'string' &&
		isMediaKind( candidate.mediaKind ) &&
		typeof candidate.alt === 'string' &&
		( candidate.mediaId === null ||
			( typeof candidate.mediaId === 'number' &&
				Number.isInteger( candidate.mediaId ) &&
				candidate.mediaId >= 0 ) )
	);
}

export function isMediaKind( value: unknown ): value is MediaKind {
	return MEDIA_KINDS.includes( value as MediaKind );
}
