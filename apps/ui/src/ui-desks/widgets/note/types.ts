import type { RectangleWidgetShapeProps } from '@/ui-desks/shapes/rectangle-widget/types';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const NOTE_WIDGET_TYPE = 'note';

export const NOTE_TONES = [
	'yellow',
	'mint',
	'blue',
	'orange',
	'violet',
	'neon-yellow',
	'neon-green',
	'neon-violet',
	'neon-orange',
	'neon-blue',
] as const;

export type NoteTone = ( typeof NOTE_TONES )[ number ];

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
	return NOTE_TONES.includes( value as NoteTone );
}
