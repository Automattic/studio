import { __ } from '@wordpress/i18n';
import { pencil } from '@wordpress/icons';
import { BOOKMARK_WIDGET_TYPE } from '@/ui-desks/widgets/bookmark/types';
import { EMBED_WIDGET_TYPE } from '@/ui-desks/widgets/embed/types';
import { MEDIA_WIDGET_TYPE } from '@/ui-desks/widgets/media/types';
import {
	NoteWidgetComponent,
	NoteWidgetThumbnailComponent,
} from '@/ui-desks/widgets/note/component';
import { NoteTextSizeControl } from '@/ui-desks/widgets/note/text-controls';
import { getFittedNoteHeight } from '@/ui-desks/widgets/note/text-sizing';
import {
	isNoteWidgetProps,
	NOTE_WIDGET_TYPE,
	type NoteTone,
	type NoteWidget,
} from '@/ui-desks/widgets/note/types';
import { PAGE_WIDGET_TYPE } from '@/ui-desks/widgets/page/types';
import { POST_WIDGET_TYPE } from '@/ui-desks/widgets/post/types';
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

const NOTE_TONE_OPTIONS: Array< { value: NoteTone; label: string; color: string } > = [
	{ value: 'yellow', label: __( 'Yellow' ), color: '#fff8c5' },
	{ value: 'neon-yellow', label: __( 'Neon yellow' ), color: 'rgb(255, 236, 61)' },
	{ value: 'mint', label: __( 'Mint' ), color: '#d9f5e1' },
	{ value: 'neon-green', label: __( 'Neon green' ), color: '#6cda76' },
	{ value: 'blue', label: __( 'Blue' ), color: '#c5deff' },
	{ value: 'neon-blue', label: __( 'Neon blue' ), color: '#52aeff' },
	{ value: 'orange', label: __( 'Orange' ), color: '#ffd8b0' },
	{ value: 'neon-orange', label: __( 'Neon orange' ), color: '#f5b047' },
	{ value: 'violet', label: __( 'Violet' ), color: '#e0c8ff' },
	{ value: 'neon-violet', label: __( 'Neon violet' ), color: '#be89ec' },
];

export const noteWidgetDefinition = {
	type: NOTE_WIDGET_TYPE,
	name: () => __( 'Note' ),
	Component: NoteWidgetComponent,
	thumbnail: NoteWidgetThumbnailComponent,
	controls: [
		{
			type: 'custom',
			id: 'text-size',
			Component: NoteTextSizeControl,
		},
		{
			type: 'color',
			id: 'tone',
			property: 'tone',
			label: __( 'Color' ),
			options: NOTE_TONE_OPTIONS,
		},
	],
	isWidgetProps: isNoteWidgetProps,
	getIndicator: ( widgetProps ) => ( {
		cornerRadius: 14,
		stroke: NOTE_TONE_STROKE[ widgetProps.tone ],
	} ),
	labels: {
		add: () => __( 'New sticky note' ),
		fitContent: () => __( 'Fit text' ),
	},
	icon: pencil,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 200,
			h: 200,
		},
		widgetProps: {
			text: '',
			tone: 'yellow',
		},
	} ),
	getSummary: ( widgetProps ) =>
		truncateText( stripMarkup( widgetProps.text ), 72 ) || __( 'Empty note' ),
	getEditAction: () => ( { kind: 'canvas-editing' } ),
	getFittedShapeProps: ( { widgetProps, shapeProps } ) => ( {
		...shapeProps,
		h: getFittedNoteHeight( widgetProps, shapeProps ),
	} ),
	dropHandlers: [
		{
			id: 'connect-widget-to-note',
			type: 'connector',
			sourceTypes: [
				MEDIA_WIDGET_TYPE,
				POST_WIDGET_TYPE,
				PAGE_WIDGET_TYPE,
				NOTE_WIDGET_TYPE,
				BOOKMARK_WIDGET_TYPE,
				EMBED_WIDGET_TYPE,
			],
		},
	],
} satisfies WidgetDefinition< NoteWidget >;

function stripMarkup( value: string ) {
	return value
		.replace( /<[^>]*>/g, ' ' )
		.replace( /\s+/g, ' ' )
		.trim();
}

function truncateText( value: string, maxLength: number ) {
	if ( value.length <= maxLength ) {
		return value;
	}

	return `${ value.slice( 0, maxLength - 3 ).trimEnd() }...`;
}
