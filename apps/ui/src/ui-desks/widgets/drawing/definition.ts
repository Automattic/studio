import { __ } from '@wordpress/i18n';
import { verse } from '@wordpress/icons';
import { DrawingWidgetComponent } from '@/ui-desks/widgets/drawing/component';
import {
	DRAWING_WIDGET_TYPE,
	isDrawingWidgetProps,
	type DrawingWidget,
} from '@/ui-desks/widgets/drawing/types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const drawingWidgetDefinition = {
	type: DRAWING_WIDGET_TYPE,
	name: () => __( 'Drawing' ),
	Component: DrawingWidgetComponent,
	isWidgetProps: isDrawingWidgetProps,
	labels: {
		add: () => __( 'New drawing' ),
	},
	icon: verse,
	isCreatable: false,
	getSummary: () => __( 'Freehand drawing' ),
	getInitialWidget: () => ( {
		shapeProps: {
			w: 320,
			h: 240,
		},
		widgetProps: {
			svg: '',
		},
	} ),
} satisfies WidgetDefinition< DrawingWidget >;
