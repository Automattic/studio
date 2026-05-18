import { __ } from '@wordpress/i18n';
import { color } from '@wordpress/icons';
import {
	ColorWidgetComponent,
	ColorWidgetThumbnailComponent,
	indicatorShade,
} from '@/ui-desks/widgets/color/component';
import { ColorToolbarControl } from '@/ui-desks/widgets/color/toolbar-control';
import { COLOR_WIDGET_TYPE, isColorWidgetProps, type ColorWidget } from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const colorWidgetDefinition = {
	type: COLOR_WIDGET_TYPE,
	name: () => __( 'Color' ),
	Component: ColorWidgetComponent,
	thumbnail: ColorWidgetThumbnailComponent,
	isCreatable: false,
	isWidgetProps: isColorWidgetProps,
	controls: [
		{
			type: 'custom',
			id: 'copy-color',
			Component: ColorToolbarControl,
		},
	],
	getIndicator: ( widgetProps ) => ( {
		cornerRadius: 14,
		stroke: indicatorShade( widgetProps.color ),
	} ),
	labels: {
		add: () => __( 'Color' ),
	},
	icon: color,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 140,
			h: 140,
		},
		widgetProps: {
			color: '#111111',
			title: '',
		},
	} ),
	getSummary: ( widgetProps ) => widgetProps.title || widgetProps.color,
	pasteHandlers: [
		{
			id: 'color-value',
			accept: {
				kinds: [ 'color' ],
			},
			handle: async ( payload ) => {
				if ( payload.kind !== 'color' ) {
					return null;
				}

				return {
					widgetProps: {
						color: payload.color,
						title: '',
					},
					shouldStartEditing: false,
				};
			},
		},
	],
} satisfies WidgetDefinition< ColorWidget >;
