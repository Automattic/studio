import type { RectangleWidgetShapeProps } from '@/ui-desks/widgets/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const NOTE_WIDGET_TYPE = 'note';

export const NOTE_TEXT_SIZE_STEPS = [ 0, 1, 2, 3 ] as const;
export const NOTE_TEXT_SIZE_COUNT = NOTE_TEXT_SIZE_STEPS.length;

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
export type NoteTextSize = ( typeof NOTE_TEXT_SIZE_STEPS )[ number ];

export type NoteWidgetProps = {
	text: string;
	tone: NoteTone;
	textSize?: NoteTextSize;
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
		isNoteTone( ( value as Partial< NoteWidgetProps > ).tone ) &&
		isOptionalNoteTextSize( ( value as Partial< NoteWidgetProps > ).textSize )
	);
}

export function isNoteTone( value: unknown ): value is NoteTone {
	return NOTE_TONES.includes( value as NoteTone );
}

export function isNoteTextSize( value: unknown ): value is NoteTextSize {
	return NOTE_TEXT_SIZE_STEPS.includes( value as NoteTextSize );
}

function isOptionalNoteTextSize( value: unknown ): value is NoteTextSize | undefined {
	return value === undefined || isNoteTextSize( value );
}
