import styles from './style.module.css';
import { NOTE_TEXT_SIZE_COUNT, type NoteWidgetProps } from './types';
import type { RectangleWidgetShapeProps } from '@/ui-desks/widgets/geometry';

const NOTE_MIN_FIT_HEIGHT = 80;

export function getNoteTextSize( widgetProps: NoteWidgetProps ) {
	const textSize = widgetProps.textSize;
	if ( typeof textSize !== 'number' ) {
		return 0;
	}

	return Math.min( NOTE_TEXT_SIZE_COUNT - 1, Math.max( 0, Math.floor( textSize ) ) );
}

export function getFittedNoteHeight(
	widgetProps: NoteWidgetProps,
	shapeProps: RectangleWidgetShapeProps
) {
	if ( typeof document === 'undefined' ) {
		return shapeProps.h;
	}

	const probe = document.createElement( 'div' );
	probe.style.cssText =
		'position:absolute;top:-99999px;left:0;visibility:hidden;pointer-events:none;';

	const note = document.createElement( 'div' );
	note.className = styles.note;
	note.dataset.tone = widgetProps.tone;
	note.dataset.isEditing = 'false';
	note.style.width = `${ shapeProps.w }px`;
	note.style.height = 'auto';

	const content = document.createElement( 'div' );
	content.className = styles.editor;
	content.dataset.textSize = String( getNoteTextSize( widgetProps ) );
	content.style.minHeight = '0';
	content.innerHTML = widgetProps.text || '&nbsp;';

	note.appendChild( content );
	probe.appendChild( note );
	document.body.appendChild( probe );
	const measuredHeight = Math.ceil( note.getBoundingClientRect().height );
	document.body.removeChild( probe );

	return Math.max( measuredHeight, NOTE_MIN_FIT_HEIGHT );
}
