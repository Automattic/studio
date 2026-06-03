import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const PDF_WIDGET_TYPE = 'pdf';

export type PdfWidgetProps = {
	url: string;
	title: string;
	mediaId: number | null;
	filesize?: number;
};

export type PdfWidget = DeskWidgetBase<
	typeof PDF_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	PdfWidgetProps
>;

export function isPdfWidgetProps( value: unknown ): value is PdfWidgetProps {
	const candidate = value as Partial< PdfWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof candidate.url === 'string' &&
		typeof candidate.title === 'string' &&
		( candidate.mediaId === null ||
			( typeof candidate.mediaId === 'number' &&
				Number.isInteger( candidate.mediaId ) &&
				candidate.mediaId >= 0 ) ) &&
		( candidate.filesize === undefined ||
			( typeof candidate.filesize === 'number' &&
				Number.isFinite( candidate.filesize ) &&
				candidate.filesize >= 0 ) )
	);
}
