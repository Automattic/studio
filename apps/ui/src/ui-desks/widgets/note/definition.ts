import { RECTANGLE_WIDGET_SHAPE_TYPE } from '@/ui-desks/shapes/rectangle-widget/types';
import { NoteWidgetComponent } from '@/ui-desks/widgets/note/component';
import {
	isNoteWidgetProps,
	NOTE_WIDGET_TYPE,
	type NoteWidget,
} from '@/ui-desks/widgets/note/types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const noteWidgetDefinition = {
	type: NOTE_WIDGET_TYPE,
	shapeType: RECTANGLE_WIDGET_SHAPE_TYPE,
	Component: NoteWidgetComponent,
	isWidgetProps: isNoteWidgetProps,
} satisfies WidgetDefinition< NoteWidget >;
