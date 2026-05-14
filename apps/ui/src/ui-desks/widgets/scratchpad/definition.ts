import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { isMediaWidgetProps, MEDIA_WIDGET_TYPE } from '@/ui-desks/widgets/media/types';
import {
	ScratchpadWidgetComponent,
	ScratchpadWidgetThumbnailComponent,
} from '@/ui-desks/widgets/scratchpad/component';
import {
	SCRATCHPAD_DEFAULT_SHAPE_PROPS,
	getFittedScratchpadShapeProps,
} from '@/ui-desks/widgets/scratchpad/sizing';
import {
	SCRATCHPAD_WIDGET_TYPE,
	isScratchpadWidgetProps,
	type ScratchpadWidget,
} from '@/ui-desks/widgets/scratchpad/types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const scratchpadWidgetDefinition = {
	type: SCRATCHPAD_WIDGET_TYPE,
	name: () => __( 'Scratchpad' ),
	Component: ScratchpadWidgetComponent,
	thumbnail: ScratchpadWidgetThumbnailComponent,
	isCreatable: true,
	shouldStartEditingOnCreate: false,
	isWidgetProps: isScratchpadWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 18,
		stroke: '#14171a',
	} ),
	labels: {
		add: () => __( 'New scratchpad' ),
	},
	icon: external,
	getInitialWidget: () => ( {
		shapeProps: { ...SCRATCHPAD_DEFAULT_SHAPE_PROPS },
		widgetProps: {
			html: '',
			title: '',
			scope: 'block',
			description: '',
		},
	} ),
	getSummary: ( widgetProps ) => widgetProps.title || __( 'Untitled scratchpad' ),
	getEditAction: () => ( { kind: 'canvas-editing' } ),
	getFittedShapeProps: getFittedScratchpadShapeProps,
	dropHandlers: [
		{
			id: 'media-actions-for-scratchpad',
			type: 'custom',
			sourceTypes: [ MEDIA_WIDGET_TYPE ],
			canHandle: ( sourceWidget ) => isMediaWidgetProps( sourceWidget.widgetProps ),
		},
	],
} satisfies WidgetDefinition< ScratchpadWidget >;
