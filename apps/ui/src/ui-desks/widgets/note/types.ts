import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShapeProps,
} from '@/ui-desks/shapes/rectangle-widget/types';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const NOTE_WIDGET_TYPE = 'note';

export type NoteColor = 'yellow' | 'blue' | 'green' | 'pink';

export type NoteWidgetProps = {
	text: string;
	color: NoteColor;
};

export type NoteWidget = DeskWidgetBase<
	typeof NOTE_WIDGET_TYPE,
	typeof RECTANGLE_WIDGET_SHAPE_TYPE,
	RectangleWidgetShapeProps,
	NoteWidgetProps
>;

export function isNoteWidgetProps( value: unknown ): value is NoteWidgetProps {
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof ( value as Partial< NoteWidgetProps > ).text === 'string' &&
		isNoteColor( ( value as Partial< NoteWidgetProps > ).color )
	);
}

function isNoteColor( value: unknown ): value is NoteColor {
	return value === 'yellow' || value === 'blue' || value === 'green' || value === 'pink';
}
