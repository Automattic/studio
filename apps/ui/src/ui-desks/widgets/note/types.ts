import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const NOTE_WIDGET_TYPE = 'note';

export const NOTE_TEXT_SIZE_STEPS = [ 0, 1, 2, 3 ] as const;
export const NOTE_TEXT_SIZE_COUNT = NOTE_TEXT_SIZE_STEPS.length;

export const NOTE_TONES = [
	'grey',
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

export type NoteAnnotation = {
	selector: string;
	displayName: string;
	tag?: string;
	nearbyText?: string;
	pathname?: string;
	url?: string;
	timestamp?: number;
	boundingBox?: {
		top: number;
		left: number;
		width: number;
		height: number;
	};
	previewShapeId?: string;
	previewWidgetId?: string;
};

export type NoteWidgetProps = {
	text: string;
	tone: NoteTone;
	textSize?: NoteTextSize;
	annotation?: NoteAnnotation;
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
		isOptionalNoteTextSize( ( value as Partial< NoteWidgetProps > ).textSize ) &&
		isOptionalNoteAnnotation( ( value as Partial< NoteWidgetProps > ).annotation )
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

function isOptionalNoteAnnotation( value: unknown ): value is NoteAnnotation | undefined {
	if ( value === undefined ) {
		return true;
	}
	if ( ! value || typeof value !== 'object' ) {
		return false;
	}

	const annotation = value as Partial< NoteAnnotation >;
	const boundingBox = annotation.boundingBox;
	return (
		typeof annotation.selector === 'string' &&
		typeof annotation.displayName === 'string' &&
		isOptionalString( annotation.tag ) &&
		isOptionalString( annotation.nearbyText ) &&
		isOptionalString( annotation.pathname ) &&
		isOptionalString( annotation.url ) &&
		isOptionalString( annotation.previewShapeId ) &&
		isOptionalString( annotation.previewWidgetId ) &&
		( annotation.timestamp === undefined || typeof annotation.timestamp === 'number' ) &&
		( boundingBox === undefined ||
			( typeof boundingBox.top === 'number' &&
				typeof boundingBox.left === 'number' &&
				typeof boundingBox.width === 'number' &&
				typeof boundingBox.height === 'number' ) )
	);
}

function isOptionalString( value: unknown ): value is string | undefined {
	return value === undefined || typeof value === 'string';
}
