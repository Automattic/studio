import { RECTANGLE_WIDGET_SHAPE_TYPE } from '@/ui-desks/shapes/rectangle-widget/types';
import { NoteWidgetComponent } from '@/ui-desks/widgets/note/component';
import {
	isNoteWidgetProps,
	NOTE_WIDGET_TYPE,
	type NoteTone,
	type NoteWidget,
} from '@/ui-desks/widgets/note/types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

const NOTE_TONE_STROKE: Record< NoteTone, string > = {
	yellow: '#c4a300',
	mint: '#3ca56f',
	blue: '#2271b1',
	orange: '#c97223',
	violet: '#7b3fb6',
	'neon-yellow': '#a18a00',
	'neon-green': '#2e9e3a',
	'neon-violet': '#6f2daa',
	'neon-orange': '#b97917',
	'neon-blue': '#1873c9',
};

export const noteWidgetDefinition = {
	type: NOTE_WIDGET_TYPE,
	shapeType: RECTANGLE_WIDGET_SHAPE_TYPE,
	Component: NoteWidgetComponent,
	isWidgetProps: isNoteWidgetProps,
	getIndicator: ( widgetProps ) => ( {
		cornerRadius: 14,
		stroke: NOTE_TONE_STROKE[ widgetProps.tone ],
	} ),
} satisfies WidgetDefinition< NoteWidget >;
