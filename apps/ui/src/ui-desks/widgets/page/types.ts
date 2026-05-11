import type { RectangleWidgetShapeProps } from '@/ui-desks/widgets/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const PAGE_WIDGET_TYPE = 'page';

export const PAGE_TONES = [ 'neutral', 'orange', 'red', 'violet', 'blue', 'sky', 'green' ] as const;

export type PageTone = ( typeof PAGE_TONES )[ number ];

export type PageWidgetProps = {
	pageId: number;
	tone: PageTone;
};

export type PageWidget = DeskWidgetBase<
	typeof PAGE_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	PageWidgetProps
>;

export function isPageWidgetProps( value: unknown ): value is PageWidgetProps {
	const candidate = value as Partial< PageWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof candidate.pageId === 'number' &&
		Number.isInteger( candidate.pageId ) &&
		candidate.pageId >= 0 &&
		isPageTone( candidate.tone )
	);
}

export function isPageTone( value: unknown ): value is PageTone {
	return PAGE_TONES.includes( value as PageTone );
}
