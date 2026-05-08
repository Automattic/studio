import type { RectangleWidgetShapeProps } from '@/ui-desks/shapes/rectangle-widget/types';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const NOTE_WIDGET_TYPE = 'note';

export type NoteTone =
	| 'note'
	| 'note-mint'
	| 'note-blue'
	| 'note-orange'
	| 'note-violet'
	| 'note-neon-yellow'
	| 'note-neon-green'
	| 'note-neon-violet'
	| 'note-neon-orange'
	| 'note-neon-blue';

export type NoteWidgetProps = {
	text: string;
	tone: NoteTone;
};

export type NoteWidget = DeskWidgetBase<
	typeof NOTE_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	NoteWidgetProps
>;

export function isNoteWidgetProps( value: unknown ): value is NoteWidgetProps {
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof ( value as Partial< NoteWidgetProps > ).text === 'string' &&
		isNoteTone( ( value as Partial< NoteWidgetProps > ).tone )
	);
}

export function isNoteTone( value: unknown ): value is NoteTone {
	return (
		value === 'note' ||
		value === 'note-mint' ||
		value === 'note-blue' ||
		value === 'note-orange' ||
		value === 'note-violet' ||
		value === 'note-neon-yellow' ||
		value === 'note-neon-green' ||
		value === 'note-neon-violet' ||
		value === 'note-neon-orange' ||
		value === 'note-neon-blue'
	);
}
