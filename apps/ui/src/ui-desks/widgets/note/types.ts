import type { DeskWidgetBase } from '@studio/common/types/desk';
import type { TLBaseShape } from 'tldraw';

export const NOTE_WIDGET_TYPE = 'note';
export const NOTE_WIDGET_CANVAS_TYPE = 'studio-note';

export type NoteColor = 'yellow' | 'blue' | 'green' | 'pink';

export type NoteWidget = DeskWidgetBase<
	typeof NOTE_WIDGET_TYPE,
	{
		w: number;
		h: number;
		text: string;
		color: NoteColor;
	}
>;

export type NoteShape = TLBaseShape< typeof NOTE_WIDGET_CANVAS_TYPE, NoteWidget[ 'props' ] >;
