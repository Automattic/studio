import { NOTE_WIDGET_TYPE, type NoteWidget } from '@/ui-desks/widgets/note/types';

interface CreateNoteWidgetOptions {
	id: string;
	x: number;
	y: number;
	zIndex: string;
	text?: string;
}

export function createNoteWidget( {
	id,
	x,
	y,
	zIndex,
	text = '',
}: CreateNoteWidgetOptions ): NoteWidget {
	return {
		id,
		type: NOTE_WIDGET_TYPE,
		x,
		y,
		zIndex,
		props: {
			w: 260,
			h: 220,
			text,
			color: 'yellow',
		},
	};
}
