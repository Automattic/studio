import { RECTANGLE_WIDGET_SHAPE_TYPE } from '@/ui-desks/shapes/rectangle-widget/types';
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
		shapeType: RECTANGLE_WIDGET_SHAPE_TYPE,
		x,
		y,
		zIndex,
		shapeProps: {
			w: 260,
			h: 220,
		},
		widgetProps: {
			text,
			color: 'yellow',
		},
	};
}
